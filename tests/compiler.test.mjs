import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildDocx,
  buildEpub,
  crc32,
  parseDocxBytes,
  parseEpubBytes,
  parseZipEntries,
} from '../public/compiler.js'

const HOSTILE_TITLE = '<script>alert("x")</script> & \'quotes\''
const HOSTILE_BODY = 'First <b>bold</b> & <img src=x onerror=y>\n\nSecond line with </w:t> and </p> tricks\n\n\nFourth after blank'

function utf8(bytes) {
  return new TextDecoder().decode(bytes)
}

describe('H17 manuscript compiler', () => {
  it('DOCX and EPUB start with PK magic', () => {
    for (const bytes of [buildDocx('T', 'B'), buildEpub('T', 'B')]) {
      assert.equal(bytes[0], 0x50)
      assert.equal(bytes[1], 0x4b)
    }
  })

  it('EPUB mimetype is the first stored entry with no extra field', () => {
    const entries = parseZipEntries(buildEpub('T', 'B'))
    assert.equal(entries[0].name, 'mimetype')
    assert.equal(entries[0].method, 0)
    assert.equal(entries[0].extraLen, 0)
    assert.equal(utf8(entries[0].data), 'application/epub+zip')
  })

  it('DOCX round-trips exactly, hostile markup escaped', () => {
    const bytes = buildDocx(HOSTILE_TITLE, HOSTILE_BODY)
    assert.deepEqual(parseDocxBytes(bytes), { title: HOSTILE_TITLE, body: HOSTILE_BODY })
    const raw = utf8(bytes)
    assert.ok(!raw.includes('<script>'), 'raw DOCX must not contain live markup')
    assert.ok(raw.includes('&lt;script&gt;'), 'hostile markup must be entity-escaped')
  })

  it('EPUB round-trips exactly, hostile markup escaped', () => {
    const bytes = buildEpub(HOSTILE_TITLE, HOSTILE_BODY, 'Ember')
    assert.deepEqual(parseEpubBytes(bytes), { title: HOSTILE_TITLE, body: HOSTILE_BODY })
    const raw = utf8(bytes)
    assert.ok(!raw.includes('<script>'), 'raw EPUB must not contain live markup')
    assert.ok(raw.includes('&lt;script&gt;'), 'hostile markup must be entity-escaped')
  })

  it('Geor styling markers are present', () => {
    const docxRaw = utf8(buildDocx('T', 'B'))
    assert.ok(docxRaw.includes('C9A227'), 'DOCX needs the Geor gold heading color')
    const epubRaw = utf8(buildEpub('T', 'B'))
    assert.ok(epubRaw.includes('#C9A227'), 'EPUB needs the gold heading style')
    assert.ok(epubRaw.includes('#FAF6EC'), 'EPUB needs the cream page style')
    assert.ok(epubRaw.includes('#1A1611'), 'EPUB needs the ink text style')
  })

  it('stored CRCs validate for every entry', () => {
    for (const bytes of [buildDocx(HOSTILE_TITLE, HOSTILE_BODY), buildEpub(HOSTILE_TITLE, HOSTILE_BODY)]) {
      for (const entry of parseZipEntries(bytes)) {
        assert.equal(crc32(entry.data), entry.crc, `CRC mismatch on ${entry.name}`)
      }
    }
  })

  it('compiler adds no fetch and no new endpoints', () => {
    const source = readFileSync(new URL('../public/compiler.js', import.meta.url), 'utf8')
    assert.ok(!source.includes('fetch('), 'compiler must not fetch')
    assert.ok(!source.includes('/api/'), 'compiler must not add endpoints')
  })
})
