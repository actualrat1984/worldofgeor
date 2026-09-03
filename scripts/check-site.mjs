import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const publicRoot = path.join(root, 'public')
const distRoot = path.join(root, 'dist')
const sourceFiles = [path.join(root, 'index.html')]

function collectHtml(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collectHtml(absolute)
    else if (entry.name.endsWith('.html')) sourceFiles.push(absolute)
  }
}
collectHtml(publicRoot)

const aliases = new Map([
  ['/updates', '/updates.html'],
  ['/timeline', '/timeline.html'],
  ['/gazetteer', '/gazetteer.html'],
  ['/trees', '/trees.html'],
  ['/notebook', '/notebook.html'],
  ['/manuscripts', '/manuscripts.html'],
  ['/boards', '/boards.html'],
  ['/chronicles', '/chronicles.html'],
  ['/webs', '/webs.html'],
  ['/gallery', '/gallery.html'],
  ['/oracle', '/oracle.html'],
  ['/atlas', '/atlas.html'],
  ['/map-editor', '/map-editor.html'],
  ['/species', '/species.html'],
  ['/search', '/search.html'],
  ['/dashboard', '/dashboard.html'],
  ['/admin', '/admin.html'],
  ['/app', '/app/index.html'],
])
const failures = []
let checkedLinks = 0
let checkedImages = 0

for (const required of ['archive-compass.css', 'archive-compass.js']) {
  if (!fs.existsSync(path.join(publicRoot, required))) failures.push(`public/${required}: required private archive shell asset is missing`)
}

function cleanLocalUrl(raw) {
  const value = raw.trim()
  if (!value || value.startsWith('#') || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value)) return null
  const pathOnly = value.split('#', 1)[0].split('?', 1)[0]
  try { return decodeURIComponent(pathOnly) } catch { return pathOnly }
}

function candidatesFor(localUrl) {
  const normalized = aliases.get(localUrl) || localUrl
  const relative = normalized.replace(/^\/+/, '').replace(/\/$/, '')
  const candidates = []
  if (!relative) candidates.push(path.join(root, 'index.html'))
  else {
    candidates.push(path.join(publicRoot, relative), path.join(root, relative), path.join(distRoot, relative))
    candidates.push(path.join(publicRoot, relative, 'index.html'), path.join(distRoot, relative, 'index.html'))
  }
  return candidates
}

function verifyUrl(file, raw, kind) {
  const localUrl = cleanLocalUrl(raw)
  if (!localUrl) return
  checkedLinks++
  if (kind === 'img') checkedImages++
  if (!candidatesFor(localUrl).some(candidate => fs.existsSync(candidate))) {
    failures.push(`${path.relative(root, file)}: missing ${raw}`)
  }
}

for (const file of sourceFiles) {
  const html = fs.readFileSync(file, 'utf8')
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
  const ids = [...markup.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1])
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index)
  for (const id of new Set(duplicateIds)) failures.push(`${path.relative(root, file)}: duplicate id ${id}`)
  if (file === path.join(root, 'index.html')) {
    for (const id of ['world', 'atlas', 'history', 'gallery', 'wiki', 'updates', 'editor']) {
      if (!ids.includes(id)) failures.push(`index.html: missing feature anchor #${id}`)
    }
  }
  for (const match of markup.matchAll(/\b(href|src)\s*=\s*["']([^"']+)["']/gi)) {
    verifyUrl(file, match[2], match[1].toLowerCase() === 'src' ? 'img' : 'link')
  }
  for (const match of markup.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const candidate of match[1].split(',')) verifyUrl(file, candidate.trim().split(/\s+/, 1)[0], 'img')
  }
  for (const match of markup.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/\brel=["'][^"']*noopener/i.test(match[0])) failures.push(`${path.relative(root, file)}: target=_blank missing rel=noopener`)
  }
  for (const match of markup.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/.test(match[0])) failures.push(`${path.relative(root, file)}: image missing alt text`)
  }
}

if (failures.length) {
  console.error(`Site check failed with ${failures.length} issue(s):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`Site check passed: ${sourceFiles.length} HTML files, ${checkedLinks} local references, ${checkedImages} image references.`)
