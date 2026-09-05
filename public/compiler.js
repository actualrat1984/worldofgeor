// H17 — pure-JS DOCX/EPUB compiler for the Manuscripts page.
// Zero dependencies, no network, no worker routes: builds minimal valid
// .docx / .epub files (stored-ZIP, self-written CRC32) on this device only.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function xmlUnescape(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function utf8Bytes(str) {
  return new TextEncoder().encode(String(str ?? ''))
}

function utf8Text(bytes) {
  return new TextDecoder().decode(bytes)
}

function cleanTitle(title) {
  return String(title ?? '').trim().slice(0, 200)
}

function bodyText(body) {
  return typeof body === 'string' ? body : String(body ?? '')
}

// Fixed DOS timestamp (2024-01-01) so builds are deterministic.
const DOS_TIME = 0
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1

// Minimal stored (uncompressed) ZIP writer. Entries keep insertion order,
// which the EPUB spec needs (mimetype first, stored, no extra field).
export function makeZip(entries) {
  const prepared = entries.map((entry) => {
    const nameBytes = utf8Bytes(entry.name)
    const data = entry.data instanceof Uint8Array ? entry.data : Uint8Array.from(entry.data || [])
    return { nameBytes, data, crc: crc32(data) }
  })
  const localParts = []
  const centralParts = []
  let offset = 0
  let centralSize = 0
  for (const { nameBytes, data, crc } of prepared) {
    const head = new Uint8Array(30 + nameBytes.length)
    const v = new DataView(head.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 0x0800, true) // UTF-8 entry names
    v.setUint16(8, 0, true) // stored, no compression
    v.setUint16(10, DOS_TIME, true)
    v.setUint16(12, DOS_DATE, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, data.length, true)
    v.setUint32(22, data.length, true)
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, 0, true)
    head.set(nameBytes, 30)
    localParts.push(head, data)
    const central = new Uint8Array(46 + nameBytes.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, DOS_TIME, true)
    c.setUint16(14, DOS_DATE, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, nameBytes.length, true)
    c.setUint16(30, 0, true)
    c.setUint16(32, 0, true)
    c.setUint16(34, 0, true)
    c.setUint16(36, 0, true)
    c.setUint32(38, 0, true)
    c.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)
    offset += head.length + data.length
    centralSize += central.length
  }
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(4, 0, true)
  e.setUint16(6, 0, true)
  e.setUint16(8, prepared.length, true)
  e.setUint16(10, prepared.length, true)
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true)
  e.setUint16(20, 0, true)
  let total = end.length
  for (const part of localParts) total += part.length
  for (const part of centralParts) total += part.length
  const out = new Uint8Array(total)
  let at = 0
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// Read back stored-ZIP entries: { name, data, crc, method, extraLen }.
export function parseZipEntries(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || [])
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const entries = []
  let off = 0
  while (off + 30 <= data.length) {
    if (v.getUint32(off, true) !== 0x04034b50) break
    const method = v.getUint16(off + 8, true)
    const crc = v.getUint32(off + 14, true)
    const compSize = v.getUint32(off + 18, true)
    const nameLen = v.getUint16(off + 26, true)
    const extraLen = v.getUint16(off + 28, true)
    const name = utf8Text(data.subarray(off + 30, off + 30 + nameLen))
    const start = off + 30 + nameLen + extraLen
    entries.push({ name, data: data.slice(start, start + compSize), crc, method, extraLen })
    off = start + compSize
  }
  return entries
}

// Ge'or gold for the title heading, warm ink for body text.
const GEOR_GOLD = 'C9A227'
const GEOR_INK = '2A241C'

const DOCX_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '</Types>'

const DOCX_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>'

const DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>'
  + `<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/><w:color w:val="${GEOR_INK}"/></w:rPr></w:style>`
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>'
  + `<w:rPr><w:rFonts w:ascii="Cinzel" w:hAnsi="Cinzel"/><w:b/><w:sz w:val="52"/><w:color w:val="${GEOR_GOLD}"/></w:rPr></w:style>`
  + '</w:styles>'

function docxParagraph(styleId, text) {
  const style = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : ''
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
}

export function buildDocx(title, body) {
  const name = cleanTitle(title)
  const paras = [docxParagraph('Heading1', name)]
  for (const line of bodyText(body).split('\n')) paras.push(docxParagraph('', line))
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + paras.join('')
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
    + '</w:body></w:document>'
  return makeZip([
    { name: '[Content_Types].xml', data: utf8Bytes(DOCX_CONTENT_TYPES) },
    { name: '_rels/.rels', data: utf8Bytes(DOCX_RELS) },
    { name: 'word/styles.xml', data: utf8Bytes(DOCX_STYLES) },
    { name: 'word/document.xml', data: utf8Bytes(documentXml) },
  ])
}

export function parseDocxBytes(bytes) {
  const entry = parseZipEntries(bytes).find((e) => e.name === 'word/document.xml')
  if (!entry || entry.method !== 0) throw new Error('Not a Geor manuscript DOCX')
  const xml = utf8Text(entry.data)
  const paras = []
  const paraRe = /<w:p>([\s\S]*?)<\/w:p>/g
  let match
  while ((match = paraRe.exec(xml)) !== null) {
    const texts = []
    const textRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
    let inner
    while ((inner = textRe.exec(match[1])) !== null) texts.push(xmlUnescape(inner[1]))
    paras.push(texts.join(''))
  }
  if (paras.length === 0) return { title: '', body: '' }
  return { title: paras[0], body: paras.slice(1).join('\n') }
}

const EPUB_MIMETYPE = 'application/epub+zip'
const EPUB_CONTAINER = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
  + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
  + '</container>'

function epubPackage(title) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<package version="3.0" unique-identifier="geor-id" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + '<metadata><dc:identifier id="geor-id">geor-manuscript</dc:identifier>'
    + `<dc:title>${xmlEscape(title || 'Untitled chapter')}</dc:title>`
    + '<dc:creator>World of Ge&apos;or</dc:creator><dc:language>en</dc:language>'
    + '<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta></metadata>'
    + '<manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>'
    + '<spine><itemref idref="chapter"/></spine></package>'
}

function epubChapter(title, body, book) {
  const name = cleanTitle(title)
  const bookLine = String(book ?? '').trim()
    ? `<p class="geor-book">World of Ge&apos;or &#183; ${xmlEscape(String(book).trim())}</p>`
    : ''
  const paras = bodyText(body).split('\n')
    .map((line) => (line ? `<p>${xmlEscape(line)}</p>` : '<p><br/></p>'))
    .join('')
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<!DOCTYPE html>'
    + '<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>'
    + `<title>${xmlEscape(name || 'Untitled chapter')}</title>`
    + '<style>'
    + "body{background:#FAF6EC;color:#1A1611;font-family:Georgia,'Cormorant Garamond',serif;line-height:1.7;max-width:640px;margin:0 auto;padding:2rem}"
    + "h1{font-family:Cinzel,Georgia,serif;color:#C9A227;font-size:1.9rem;line-height:1.2;margin:0 0 .4rem}"
    + 'p.geor-book{color:#8A6D1C;font-size:.7rem;letter-spacing:.25em;text-transform:uppercase;margin:0 0 1.2rem}'
    + 'p{margin:0 0 1em}'
    + '</style></head><body>'
    + bookLine
    + `<h1>${xmlEscape(name)}</h1>`
    + paras
    + '</body></html>'
}

export function buildEpub(title, body, book) {
  return makeZip([
    { name: 'mimetype', data: utf8Bytes(EPUB_MIMETYPE) },
    { name: 'META-INF/container.xml', data: utf8Bytes(EPUB_CONTAINER) },
    { name: 'OEBPS/content.opf', data: utf8Bytes(epubPackage(cleanTitle(title))) },
    { name: 'OEBPS/chapter.xhtml', data: utf8Bytes(epubChapter(title, body, book)) },
  ])
}

export function parseEpubBytes(bytes) {
  const entries = parseZipEntries(bytes)
  const entry = entries.find((e) => e.name === 'OEBPS/chapter.xhtml')
    || entries.find((e) => e.name.endsWith('.xhtml'))
  if (!entry || entry.method !== 0) throw new Error('Not a Geor manuscript EPUB')
  const xml = utf8Text(entry.data)
  const heading = xml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  const lines = []
  const paraRe = /<p([^>]*)>([\s\S]*?)<\/p>/g
  let match
  while ((match = paraRe.exec(xml)) !== null) {
    if (String(match[1] || '').includes('geor-book')) continue
    const inner = match[2]
    lines.push(inner === '<br/>' || inner === '<br />' ? '' : xmlUnescape(inner))
  }
  return { title: heading ? xmlUnescape(heading[1]) : '', body: lines.join('\n') }
}

// Browser-only download helper mirroring the manuscripts page pattern
// (Blob + anchor + revoke). Returns false outside a browser.
export function downloadBytes(bytes, name, mimeType) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false
  const blob = new Blob([bytes], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = String(name || 'chapter')
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
