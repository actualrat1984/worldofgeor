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
  }
  const closeMenu = () => setMenu(false)
  btn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.classList.contains('hidden')) })
  menu.querySelectorAll('a, button').forEach(el => el.addEventListener('click', closeMenu))
  document.addEventListener('click', (e) => { if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) closeMenu() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu() })
}

// nav hide-on-scroll + active highlight
const header = document.querySelector('header')
let lastY = window.scrollY
let ticking = false
if (header) {
  header.style.transition = 'transform 0.28s ease'
  window.addEventListener('scroll', () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      const cur = window.scrollY
      const goingDown = cur > lastY && cur > 80
      header.style.transform = goingDown ? 'translateY(-100%)' : 'translateY(0)'
      lastY = cur
      ticking = false
    })
  }, { passive: true })
}

// active section highlight
const navLinks = document.querySelectorAll('header nav a[href^="#"], #mobileMenu a[href^="#"]')
const sections = ['world','atlas','history','gallery'].map(id => document.getElementById(id)).filter(Boolean)
if (navLinks.length && sections.length && 'IntersectionObserver' in window) {
  const setActive = (id) => {
    navLinks.forEach(a => {
      const isActive = a.getAttribute('href') === `#${id}`
      a.classList.toggle('text-cream', isActive)
      a.classList.toggle('text-cream/70', !isActive)
      if (isActive) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current')
    })
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(ent => { if (ent.isIntersecting) setActive(ent.target.id) })
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 })
  sections.forEach(s => io.observe(s))
}

// subtle parallax for hero (respects reduced-motion)
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
