import './style.css'

// year
const y = document.getElementById('year')
if (y) y.textContent = new Date().getFullYear()

// mobile menu — close on link click, outside click, ESC (enhanced)
const btn = document.getElementById('menuBtn')
const menu = document.getElementById('mobileMenu')
if (btn && menu) {
  const setMenu = (open) => {
    menu.classList.toggle('hidden', !open)
    btn.setAttribute('aria-expanded', String(open))
    btn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation')
    menu.setAttribute('aria-hidden', String(!open))
  }
  const closeMenu = () => setMenu(false)
  setMenu(false)
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const opening = menu.classList.contains('hidden')
    setMenu(opening)
    if (opening && e.detail === 0) requestAnimationFrame(() => menu.querySelector('a, button')?.focus())
  })
  menu.querySelectorAll('a, button').forEach(el => el.addEventListener('click', closeMenu))
  document.addEventListener('click', (e) => { if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) closeMenu() })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || menu.classList.contains('hidden')) return
    closeMenu()
    btn.focus()
  })
}

// nav hide-on-scroll + active highlight
const header = document.querySelector('header')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
let lastY = window.scrollY
let ticking = false
if (header) {
  header.style.transition = reduceMotion ? 'none' : 'transform 150ms var(--ease-archive)'
  window.addEventListener('scroll', () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      const cur = window.scrollY
      const goingDown = !reduceMotion && cur > lastY && cur > 80 && !header.contains(document.activeElement) && !(menu && !menu.classList.contains('hidden'))
      header.style.transform = goingDown ? 'translateY(-100%)' : 'translateY(0)'
      lastY = cur
      ticking = false
    })
  }, { passive: true })
  header.addEventListener('focusin', () => { header.style.transform = 'translateY(0)' })
}

// Active section/page highlight. Hash links follow the landing sections; route
// links retain page semantics when this navigation is reused on another route.
const normalizePath = pathname => pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/'
const currentPath = normalizePath(window.location.pathname)
const headerLinks = [...document.querySelectorAll('header nav a[href], #mobileMenu a[href]')]
const navLinks = headerLinks.filter(link => {
  const target = new URL(link.href, window.location.href)
  return target.origin === window.location.origin && normalizePath(target.pathname) === '/' && Boolean(target.hash)
})
const pageLinks = headerLinks.filter(link => {
  const target = new URL(link.href, window.location.href)
  return target.origin === window.location.origin && !target.hash
})
pageLinks.forEach(link => {
  const target = new URL(link.href, window.location.href)
  if (target.origin === window.location.origin && normalizePath(target.pathname) === currentPath) {
    link.setAttribute('aria-current', 'page')
  } else if (link.getAttribute('aria-current') === 'page') {
    link.removeAttribute('aria-current')
  }
})
navLinks.forEach(link => {
  link.dataset.inactiveTextClass = link.classList.contains('text-cream/80') ? 'text-cream/80' : 'text-cream/70'
})
const sections = ['world','atlas','history','gallery','archive'].map(id => document.getElementById(id)).filter(Boolean)
if (navLinks.length && sections.length && 'IntersectionObserver' in window) {
  const setActive = (id) => {
    navLinks.forEach(a => {
      const isActive = a.getAttribute('href') === `#${id}`
      const inactiveClass = a.dataset.inactiveTextClass
      a.classList.toggle('text-cream', isActive)
      a.classList.toggle(inactiveClass, !isActive)
      if (isActive) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current')
    })
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(ent => { if (ent.isIntersecting) setActive(ent.target.id) })
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 })
  sections.forEach(s => io.observe(s))
}

// subtle parallax for hero (respects reduced-motion)
if (!reduceMotion) {
  const heroImg = document.querySelector('section picture img')
  if (heroImg) {
    let heroTick = false
    window.addEventListener('scroll', () => {
      if (heroTick) return
      heroTick = true
      requestAnimationFrame(() => {
        const yOff = window.scrollY * 0.12
        if (window.scrollY < window.innerHeight) heroImg.style.transform = `translateY(${yOff}px) scale(1.04)`
        heroTick = false
      })
    }, { passive: true })
  }

  if ('IntersectionObserver' in window) {
    const revealTargets = document.querySelectorAll('body > section:not(:first-of-type), body > footer')
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 })
    revealTargets.forEach((target) => {
      target.classList.add('reveal-item')
      revealObserver.observe(target)
    })
  }
}

// A device-local continuation link gives returning members a useful first step
// without exposing or sending their reading history anywhere.
const continueLink = document.getElementById('continueArchive')
if (continueLink) {
  try {
    const trail = JSON.parse(localStorage.getItem('geor_archive_trail_v1') || '[]')
    const latest = Array.isArray(trail) ? trail.find(item => item && typeof item.title === 'string' && typeof item.url === 'string' && item.url.startsWith('/')) : null
    if (latest) {
      const destination = new URL(latest.url, location.origin)
      if (destination.origin === location.origin) {
        continueLink.href = destination.pathname + destination.search + destination.hash
        continueLink.querySelector('span').textContent = `CONTINUE: ${latest.title.slice(0, 42).toUpperCase()}`
        continueLink.classList.remove('hidden')
      }
    }
  } catch {}
}
