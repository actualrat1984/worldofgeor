// Wave H20: guided entry forms — vault-shaped markdown out, vault never
// touched. Per-template output carries every required frontmatter key and
// section; the validator rejects missing keys, path smuggling, and over-cap
// output; hostile markup is escaped in the preview; drafts round-trip per
// member and stay invisible across members; the page adds no fetch calls or
// new endpoints.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ENTRY_FIELD_MAX,
  ENTRY_OUTPUT_MAX,
  buildEntryMarkdown,
  entryDownloadName,
  entryDraftKey,
  readEntryDraft,
  renderEntryPreview,
  validateEntryFields,
  validateEntryMarkdown,
  writeEntryDraft,
} from '../public/entry.js'

const CHARACTER = {
  character_name: 'Kaelis Thorn',
  faction: 'Erisian Empire',
  status: 'alive',
  title_or_alias: 'The Ashen Blade',
  overview: 'A duelist known across the capital for settling border disputes.',
  biography: 'Born in Kennberg, rose through the guard, broke ranks at the ford.',
  personality: 'Driven by debt; flawed by pride; hides a desertion.',
  abilities: 'Master of the short blade; carries a signet ring.',
  relationships: 'Allied to the quartermaster; rival to her former captain.',
  keeper_notes: 'Secretly feeds information to the archive.',
}

const DEITY = {
  deity_name: 'Veyla',
  continent: 'Erisdar',
  church_name: 'Chapel of Tides',
  overview: 'Dogma calls her the tide-mother; the cult never left the coast.',
  history: 'Canon claims an ancient founding; digs say otherwise.',
  myth: 'She is said to have walked the drowned roads and named the ports.',
  governance: 'One coastal see; no schisms yet worth recording.',
}

const RACE = {
  race_name: 'Kutra',
  continent: 'Demon Continent',
  overview: 'Semi-aquatic owlkin, known for night fishing and long memory.',
  history: 'Once held the reef coves; storms and war thinned them.',
  culture: 'Clan roosts; status by navigated distance.',
  standing: 'One coastal state; wary of outsiders.',
  relations: 'Allied to the Yaoma; rivals with the wreck-lords.',
}

function fakeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: key => {
      map.delete(key)
    },
  }
}

test('character output carries all required frontmatter keys and sections', () => {
  const md = buildEntryMarkdown('character', CHARACTER)
  assert.match(md, /^tags:/m)
  assert.match(md, /^image: "Kaelis_Thorn\.png"/m)
  assert.match(md, /^aliases:/m)
  assert.match(md, /- "Erisian Empire"/)
  for (const heading of [
    '## 🎭 Overview',
    '## ⏳ Biography & Backstory',
    '## 🧠 Personality & Core Values',
    '## ⚔️ Abilities & Equipment',
    '## 🕸️ Relationships & Connections',
    '## 📝 Keeper Notes / Secrets',
  ]) {
    assert.ok(md.includes(heading), `character output includes ${heading}`)
  }
  assert.deepEqual(validateEntryMarkdown('character', md, CHARACTER.character_name), { ok: true, errors: [] })
  assert.deepEqual(validateEntryFields('character', CHARACTER), [])
})

test('deity output carries all required frontmatter keys and sections', () => {
  const md = buildEntryMarkdown('deity', DEITY)
  assert.match(md, /^tags:/m)
  assert.match(md, /^image: "Veyla\.png"/m)
  assert.match(md, /^aliases:/m)
  assert.match(md, /- "Erisdar"/)
  for (const heading of ['## 🎭 Overview', '## 📜 History', '## 📖 The Myth', '## 🏛️ Church Governance']) {
    assert.ok(md.includes(heading), `deity output includes ${heading}`)
  }
  assert.deepEqual(validateEntryMarkdown('deity', md, DEITY.deity_name), { ok: true, errors: [] })
  assert.deepEqual(validateEntryFields('deity', DEITY), [])
})

test('race output carries all required frontmatter keys and sections', () => {
  const md = buildEntryMarkdown('race', RACE)
  assert.match(md, /^tags:/m)
  assert.match(md, /^image: "Kutra\.png"/m)
  assert.match(md, /^aliases:/m)
  for (const heading of [
    '## 🎭 Overview',
    '## ⏳ History & Population Dynamics',
    '## 🧠 Culture, Society & Dogma',
    '## 🏛️ Geopolitical Standing & Factions',
    '## 🕸️ Inter-Species Relations',
    '## 📝 Keeper Notes / Secret Lore',
  ]) {
    assert.ok(md.includes(heading), `race output includes ${heading}`)
  }
  assert.deepEqual(validateEntryMarkdown('race', md, RACE.race_name), { ok: true, errors: [] })
  assert.deepEqual(validateEntryFields('race', RACE), [])
})

test('validator rejects a missing frontmatter key with a next step', () => {
  const md = buildEntryMarkdown('character', CHARACTER).replace(/^image:.*\n/m, '')
  const result = validateEntryMarkdown('character', md, CHARACTER.character_name)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('image')), 'names the missing image key')
})

test('validator rejects a missing section and an empty form names its next step', () => {
  const md = buildEntryMarkdown('race', RACE).replace('## 🕸️ Inter-Species Relations', '## Relations')
  const result = validateEntryMarkdown('race', md, RACE.race_name)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('Inter-Species')), 'names the missing section')
  const fieldErrors = validateEntryFields('race', {})
  assert.ok(fieldErrors.some(error => error.includes('race name first')), 'empty form starts with the name')
})

test('validator rejects path smuggling in names; download names stay basenames', () => {
  for (const hostile of ['../vault', 'a//b', 'a/b', 'a\\b']) {
    const result = validateEntryMarkdown('character', buildEntryMarkdown('character', CHARACTER), hostile)
    assert.equal(result.ok, false, `${hostile} is rejected`)
  }
  assert.equal(entryDownloadName('character', { character_name: '../../etc/passwd' }), 'etcpasswd-character.md')
  assert.ok(!entryDownloadName('deity', DEITY).includes('/'), 'download name holds no slash')
})

test('hostile markup is escaped in the preview, never raw', () => {
  const hostile = { ...CHARACTER, overview: '<script>alert(1)</script><img src=x onerror=alert(2)>' }
  const html = renderEntryPreview(buildEntryMarkdown('character', hostile))
  assert.ok(!html.includes('<script>'), 'no raw script tag survives')
  assert.ok(html.includes('&lt;script&gt;'), 'markup shows as escaped text')
})

test('drafts round-trip per member and stay invisible across members', () => {
  const storage = fakeStorage()
  assert.notEqual(entryDraftKey('a@archive', 'character'), entryDraftKey('b@archive', 'character'))
  writeEntryDraft(storage, 'a@archive', 'character', CHARACTER)
  assert.deepEqual(readEntryDraft(storage, 'a@archive', 'character').character_name, 'Kaelis Thorn')
  assert.deepEqual(readEntryDraft(storage, 'b@archive', 'character'), {})
  assert.deepEqual(readEntryDraft(storage, 'a@archive', 'deity'), {}, 'kinds do not share drafts')
})

test('over-cap output and fields are rejected, mirroring the manuscript cap', () => {
  assert.ok(ENTRY_OUTPUT_MAX === 100000, 'output cap mirrors MANUSCRIPT_BODY_MAX')
  const huge = buildEntryMarkdown('character', { ...CHARACTER, biography: 'x'.repeat(ENTRY_OUTPUT_MAX + 1) })
  const result = validateEntryMarkdown('character', huge, CHARACTER.character_name)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some(error => error.includes('100k')), 'cap error names the limit')
  const fieldErrors = validateEntryFields('character', { ...CHARACTER, overview: 'y'.repeat(ENTRY_FIELD_MAX + 1) })
  assert.ok(fieldErrors.some(error => error.includes('20k')), 'field cap error names the limit')
})

test('entry page adds no fetch calls and no new endpoints', () => {
  const script = readFileSync(new URL('../public/entry.js', import.meta.url), 'utf8')
  assert.equal([...script.matchAll(/\bfetch\s*\(/g)].length, 0, 'entry.js holds no fetch calls')
  assert.ok(!script.includes('/api/'), 'entry.js references no API routes')
  const html = readFileSync(new URL('../public/entry.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  for (const id of ['enTabs', 'enFields', 'enErrors', 'enPreview', 'enDownload', 'enCopy', 'enStatus']) {
    assert.ok(html.includes(`id="${id}"`), `entry.html carries #${id}`)
  }
  assert.match(html, /src="\/entry\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  assert.match(html, /nothing is filed until he approves/)
})
