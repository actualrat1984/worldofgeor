// Guided Entry (Wave H20) — vault-shaped markdown out, vault never touched.
//
// Guided forms (one per vault template: character, deity, race) that emit
// markdown mirroring the real _system/templates shapes: the same frontmatter
// keys (tags / image / aliases) and the same section headings. Output is
// downloaded or copied by hand — this page files nothing, touches no vault
// path, and adds no worker routes. Drafts autosave to member-keyed
// localStorage (same precedent as the manuscripts studio) and stay on this
// device. Pure helpers are exported so node --test can verify shapes,
// validation, key scoping, and escaping without a browser.
import { escapeHtml } from './timeline.js'
import { currentMemberEmail } from './chapter-meta.js'

// Mirrors the MANUSCRIPT_BODY_MAX precedent: one flat cap on emitted output.
export const ENTRY_OUTPUT_MAX = 100000
export const ENTRY_NAME_MAX = 120
export const ENTRY_FIELD_MAX = 20000
export const ENTRY_STORAGE_LABEL = 'Kept on this device only — per member, per entry kind.'

export const ENTRY_KINDS = {
  character: {
    label: 'Character',
    headingEmoji: '👤',
    fileSuffix: 'character',
    blurb: 'A named soul of Ge’or — mirrors CHARACTERS.md.',
    fields: [
      { key: 'character_name', label: 'Character name', required: true, area: false, hint: 'Drives the heading, image name, and file name.' },
      { key: 'faction', label: 'Faction', required: true, area: false, hint: 'Filed as a tag, e.g. Erisian Empire.' },
      { key: 'status', label: 'Status', required: true, area: false, hint: 'Filed as a tag, e.g. alive.' },
      { key: 'title_or_alias', label: 'Title or alias (optional)', required: false, area: false, hint: 'Filed under aliases; falls back to the name.' },
      { key: 'overview', label: 'Overview', required: true, area: true, hint: 'Who they are, where they are known, what hides beneath.' },
      { key: 'biography', label: 'Biography & backstory', required: true, area: true, hint: 'Roots, rise, and the turning point.' },
      { key: 'personality', label: 'Personality & core values', required: true, area: true, hint: 'Drive, flaw, and the guarded secret.' },
      { key: 'abilities', label: 'Abilities & equipment', required: true, area: true, hint: 'Talents and notable possessions.' },
      { key: 'relationships', label: 'Relationships & connections', required: true, area: true, hint: 'Allies, rivals, and rank.' },
      { key: 'keeper_notes', label: 'Keeper notes / secrets (optional)', required: false, area: true, hint: 'Stays in the file you hand over — never auto-filed.' },
    ],
  },
  deity: {
    label: 'Deity',
    headingEmoji: '🌌',
    fileSuffix: 'deity',
    blurb: 'A worshipped figure — mirrors DEITIES.md.',
    fields: [
      { key: 'deity_name', label: 'Deity name', required: true, area: false, hint: 'Drives the heading and the file name.' },
      { key: 'continent', label: 'Continent', required: true, area: false, hint: 'Filed as a tag, e.g. Erisdar.' },
      { key: 'church_name', label: 'Church name (optional)', required: false, area: false, hint: 'Used only if you mention it in the prose.' },
      { key: 'image_file', label: 'Image file stem (optional)', required: false, area: false, hint: 'Falls back to the deity name.' },
      { key: 'alternative_name', label: 'Alternative name (optional)', required: false, area: false, hint: 'Filed under aliases.' },
      { key: 'text_name', label: 'Sacred text name (optional)', required: false, area: false, hint: 'Filed under aliases; names the Myth heading.' },
      { key: 'overview', label: 'Overview', required: true, area: true, hint: 'Dogma view and the localized reality.' },
      { key: 'history', label: 'History & origin', required: true, area: true, hint: 'Canon dates, scholarly dates, and the hidden truth.' },
      { key: 'myth', label: 'The myth', required: true, area: true, hint: 'The sacred tale and its cultural footprint.' },
      { key: 'governance', label: 'Church governance & structure', required: true, area: true, hint: 'States, organization, and schisms.' },
    ],
  },
  race: {
    label: 'Race',
    headingEmoji: '🧬',
    fileSuffix: 'race',
    blurb: 'A people of Ge’or — mirrors RACES.md.',
    fields: [
      { key: 'race_name', label: 'Race name', required: true, area: false, hint: 'Drives the heading, image name, and file name.' },
      { key: 'continent', label: 'Continent', required: true, area: false, hint: 'Filed as a tag, e.g. Erisdar.' },
      { key: 'alternative_plural_name', label: 'Alternative plural (optional)', required: false, area: false, hint: 'Filed under aliases; falls back to the name.' },
      { key: 'pejorative_or_ancient_term', label: 'Pejorative or ancient term (optional)', required: false, area: false, hint: 'Filed under aliases when given.' },
      { key: 'overview', label: 'Overview', required: true, area: true, hint: 'Lifespan, habitats, and how they are perceived.' },
      { key: 'history', label: 'History & population dynamics', required: true, area: true, hint: 'Ancient peak, decline, and modern status.' },
      { key: 'culture', label: 'Culture, society & dogma', required: true, area: true, hint: 'Social structure and spiritual affinity.' },
      { key: 'standing', label: 'Geopolitical standing & factions', required: true, area: true, hint: 'Major states and outsider stances.' },
      { key: 'relations', label: 'Inter-species relations', required: true, area: true, hint: 'Allies, rivals, and avoided ties.' },
      { key: 'keeper_notes', label: 'Keeper notes / secret lore (optional)', required: false, area: true, hint: 'Stays in the file you hand over — never auto-filed.' },
    ],
  },
}

const REQUIRED_KEYS = ['tags', 'image', 'aliases']

const REQUIRED_SECTIONS = {
  // Prefixes: the deity Myth/History headings carry the entry's own names.
  character: [
    '## 🎭 Overview',
    '## ⏳ Biography & Backstory',
    '## 🧠 Personality & Core Values',
    '## ⚔️ Abilities & Equipment',
    '## 🕸️ Relationships & Connections',
    '## 📝 Keeper Notes / Secrets',
  ],
  deity: ['## 🎭 Overview', '## 📜 History', '## 📖 The Myth', '## 🏛️ Church Governance'],
  race: [
    '## 🎭 Overview',
    '## ⏳ History & Population Dynamics',
    '## 🧠 Culture, Society & Dogma',
    '## 🏛️ Geopolitical Standing & Factions',
    '## 🕸️ Inter-Species Relations',
    '## 📝 Keeper Notes / Secret Lore',
  ],
}

export function entryKinds() {
  return Object.keys(ENTRY_KINDS)
}

function cleanField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// File-safe stem for image names and download names: dots, slashes, and
// markup never survive, so structural slots cannot smuggle paths.
export function safeFileStem(raw) {
  const stem = cleanField(raw).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return stem || 'entry'
}

export function entryNameKey(kind) {
  return kind === 'deity' ? 'deity_name' : kind === 'race' ? 'race_name' : 'character_name'
}

export function entryDisplayName(kind, values) {
  return cleanField(values?.[entryNameKey(kind)])
}

// 'Kaelis' + character -> 'Kaelis-character.md'. Never a path: one basename.
export function entryDownloadName(kind, values) {
  const spec = ENTRY_KINDS[kind]
  const suffix = spec ? spec.fileSuffix : String(kind || 'entry')
  return `${safeFileStem(entryDisplayName(kind, values || {}))}-${suffix}.md`
}

function frontmatter(lines) {
  return `---\n${lines.join('\n')}\n---\n`
}

function section(title, body, fallbackLines) {
  const text = cleanField(body)
  const content = text || (fallbackLines || []).join('\n')
  return `---\n\n${title}\n\n${content}\n`
}

export function buildEntryMarkdown(kind, values) {
  const spec = ENTRY_KINDS[kind]
  const data = values && typeof values === 'object' ? values : {}
  if (!spec) return ''
  if (kind === 'character') {
    const name = cleanField(data.character_name) || 'Unnamed Character'
    const alias = cleanField(data.title_or_alias) || name
    return (
      frontmatter([
        'tags:',
        '  - character',
        '  - npc',
        `  - "${cleanField(data.faction) || 'unaffiliated'}"`,
        `  - "${cleanField(data.status) || 'unknown'}"`,
        `image: "${safeFileStem(name)}.png"`,
        'aliases:',
        `  - "${alias}"`,
      ]) +
      `\n# 👤 ${name}\n\n` +
      section('## 🎭 Overview', data.overview) +
      section('## ⏳ Biography & Backstory', data.biography) +
      section('## 🧠 Personality & Core Values', data.personality) +
      section('## ⚔️ Abilities & Equipment', data.abilities) +
      section('## 🕸️ Relationships & Connections', data.relationships) +
      section('## 📝 Keeper Notes / Secrets', data.keeper_notes, [
        '> [!WARNING] **Hidden GM/World-Builder Lore**',
        '> * Use this section to write down information players or general readers shouldn\'t know yet.',
      ])
    )
  }
  if (kind === 'deity') {
    const name = cleanField(data.deity_name) || 'Unnamed Deity'
    const continent = cleanField(data.continent) || 'unknown'
    const alt = cleanField(data.alternative_name)
    const textName = cleanField(data.text_name)
    const aliasLines = []
    if (alt) aliasLines.push(`  - "${alt}"`)
    if (textName) aliasLines.push(`  - "${textName}"`)
    if (!aliasLines.length) aliasLines.push(`  - "${name}"`)
    const mythTitle = textName ? `## 📖 The Myth of ${name} (The ${textName})` : `## 📖 The Myth of ${name}`
    return (
      frontmatter([
        'tags:',
        '  - deity',
        '  - lore',
        '  - religion',
        `  - "${continent}"`,
        `image: "${safeFileStem(cleanField(data.image_file) || name)}.png"`,
        'aliases:',
        ...aliasLines,
      ]) +
      `\n# 🌌 ${name}\n\n` +
      section('## 🎭 Overview', data.overview) +
      section('## 📜 History & Origin', data.history) +
      section(mythTitle, data.myth) +
      section('## 🏛️ Church Governance & Structure', data.governance)
    )
  }
  const name = cleanField(data.race_name) || 'Unnamed Race'
  const continent = cleanField(data.continent) || 'unknown'
  const aliasLines = [`  - "${cleanField(data.alternative_plural_name) || name}"`]
  if (cleanField(data.pejorative_or_ancient_term)) aliasLines.push(`  - "${cleanField(data.pejorative_or_ancient_term)}"`)
  return (
    frontmatter([
      'tags:',
      '  - race',
      '  - lore',
      '  - biology',
      `  - "${continent}"`,
      `image: "${safeFileStem(name)}.png"`,
      'aliases:',
      ...aliasLines,
    ]) +
    `\n# 🧬 ${name}\n\n` +
    section('## 🎭 Overview', data.overview) +
    section('## ⏳ History & Population Dynamics', data.history) +
    section('## 🧠 Culture, Society & Dogma', data.culture) +
    section('## 🏛️ Geopolitical Standing & Factions', data.standing) +
    section('## 🕸️ Inter-Species Relations', data.relations) +
    section('## 📝 Keeper Notes / Secret Lore', data.keeper_notes, [
      '> [!WARNING] **Hidden GM/World-Builder Lore**',
      '> * Record genetic or magical vulnerabilities and hidden factions here before handing the file over.',
    ])
  )
}

// Live form check: every required field names its next step in plain words.
export function validateEntryFields(kind, values) {
  const spec = ENTRY_KINDS[kind]
  const data = values && typeof values === 'object' ? values : {}
  if (!spec) return ['Choose character, deity, or race first — then the right form opens.']
  const errors = []
  for (const field of spec.fields) {
    if (!field.required || cleanField(data[field.key])) continue
    if (field.key === entryNameKey(kind)) {
      errors.push(`Add the ${spec.label.toLowerCase()} name first — the file name, image, and heading come from it.`)
    } else {
      errors.push(`Fill in “${field.label}” next — the entry cannot be filed without it.`)
    }
  }
  const name = entryDisplayName(kind, data)
  if (name) {
    const nameError = validateEntryName(name)
    if (nameError) errors.push(nameError)
  }
  const oversized = spec.fields.find(field => cleanField(data[field.key]).length > ENTRY_FIELD_MAX)
  if (oversized) errors.push(`“${oversized.label}” is over the 20k character cap — trim it, then keep going.`)
  return errors
}

export function validateEntryName(name) {
  const text = cleanField(name)
  if (!text) return 'Give the entry a name first — the file name, image, and heading come from it.'
  if (text.length > ENTRY_NAME_MAX) return `Keep the name under ${ENTRY_NAME_MAX} characters — shorten it, then try again.`
  if (text.includes('..') || text.includes('//') || text.includes('/') || text.includes('\\')) {
    return 'Keep the name file-safe — drop “..”, “//”, and slashes, then try again.'
  }
  return null
}

// Vault-shape check on emitted markdown: required frontmatter keys present,
// required sections present, name file-safe, output within the flat cap.
export function validateEntryMarkdown(kind, markdown, name) {
  const errors = []
  const spec = ENTRY_KINDS[kind]
  if (!spec) {
    return { ok: false, errors: ['Choose character, deity, or race first — then the right form opens.'] }
  }
  const text = typeof markdown === 'string' ? markdown : ''
  const fence = text.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/)
  if (!fence) {
    errors.push('Add the frontmatter block first — open with “---”, list tags, image, and aliases, close with “---”.')
  } else {
    for (const key of REQUIRED_KEYS) {
      if (!new RegExp(`^${key}:`, 'm').test(fence[1])) {
        errors.push(`The “${key}” line is missing — add “${key}:” to the frontmatter first.`)
      }
    }
  }
  for (const heading of REQUIRED_SECTIONS[kind]) {
    if (!text.includes(heading)) errors.push(`The “${heading}” section is missing — write it before downloading.`)
  }
  if (name !== undefined) {
    const nameError = validateEntryName(name)
    if (nameError) errors.push(nameError)
  }
  if (text.length > ENTRY_OUTPUT_MAX) {
    errors.push('That entry is over the 100k character cap — trim a section before downloading.')
  }
  return { ok: errors.length === 0, errors }
}

// Draft autosave key: one localStorage entry per member per entry kind, so
// drafts never leak across members on a shared device.
export function entryDraftKey(member, kind) {
  return `geor:entry-draft:${cleanField(member) || 'local'}:${String(kind || 'entry')}`
}

export function writeEntryDraft(storage, member, kind, values) {
  try {
    storage.setItem(entryDraftKey(member, kind), JSON.stringify(values || {}))
  } catch {}
}

export function readEntryDraft(storage, member, kind) {
  try {
    const parsed = JSON.parse(storage.getItem(entryDraftKey(member, kind)) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// Preview is escaped HTML: hostile markup in any field shows as text, never runs.
export function renderEntryPreview(markdown) {
  const text = typeof markdown === 'string' && markdown.trim() ? markdown : 'Nothing to preview yet — fill the form and the markdown appears here.'
  return `<div class="text-sm text-cream/80 leading-relaxed whitespace-pre-wrap font-mono">${escapeHtml(text)}</div>`
}

// --- Browser rendering (never runs under node --test) -----------------------
function initEntry() {
  const tabs = document.getElementById('enTabs')
  const fieldsBox = document.getElementById('enFields')
  const errorsBox = document.getElementById('enErrors')
  const preview = document.getElementById('enPreview')
  const status = document.getElementById('enStatus')
  const storageNote = document.getElementById('enStorageNote')
  if (!tabs || !fieldsBox || !errorsBox || !preview) return
  if (storageNote) storageNote.textContent = `Drafts autosave · ${ENTRY_STORAGE_LABEL}`
  const setStatus = message => {
    if (status) status.textContent = message
  }
  let member = 'local'
  let activeKind = 'character'
  let saveTimer = null

  const inputs = () => [...fieldsBox.querySelectorAll('[data-entry-field]')]

  const collect = () => {
    const values = {}
    for (const input of inputs()) values[input.getAttribute('data-entry-field')] = input.value
    return values
  }

  const paintErrors = errors => {
    errorsBox.innerHTML = errors.length
      ? errors.map(error => `<li class="text-sm text-amber-200/90">→ ${escapeHtml(error)}</li>`).join('')
      : '<li class="text-sm text-cream/40">All required fields are filled — preview, download, and hand it to Mikhail.</li>'
  }

  const paint = () => {
    const values = collect()
    paintErrors(validateEntryFields(activeKind, values))
    preview.innerHTML = renderEntryPreview(buildEntryMarkdown(activeKind, values))
  }

  const queueAutosave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      writeEntryDraft(localStorage, member, activeKind, collect())
      paint()
    }, 400)
  }

  const paintForm = () => {
    const spec = ENTRY_KINDS[activeKind]
    const draft = readEntryDraft(localStorage, member, activeKind)
    fieldsBox.innerHTML = spec.fields
      .map(field => {
        const id = `en-${activeKind}-${field.key}`
        const value = escapeHtml(draft[field.key] || '')
        const control = field.area
          ? `<textarea id="${id}" data-entry-field="${field.key}" rows="4" maxlength="${ENTRY_FIELD_MAX}" placeholder="${escapeHtml(field.hint)}" class="rounded-xl border border-gold/15 bg-ink px-4 py-3 text-sm text-cream/80 focus:border-gold/50 w-full"></textarea>`
          : `<input id="${id}" data-entry-field="${field.key}" type="text" maxlength="500" value="${value}" placeholder="${escapeHtml(field.hint)}" autocomplete="off" class="rounded-xl border border-gold/15 bg-ink px-4 py-3 text-sm text-cream/80 focus:border-gold/50 w-full" />`
        // Textareas cannot carry value attributes — set after insert.
        return `<label class="flex flex-col gap-2" for="${id}">`
          + `<span class="text-[10px] tracking-[.25em] text-cream/40">${escapeHtml(field.label.toUpperCase())}${field.required ? ' · REQUIRED' : ''}</span>${control}</label>`
      })
      .join('')
    for (const input of inputs()) {
      const key = input.getAttribute('data-entry-field')
      const spec_field = spec.fields.find(f => f.key === key)
      if (input.tagName === 'TEXTAREA' && spec_field?.area) input.value = draft[key] || ''
      input.addEventListener('input', queueAutosave)
    }
    for (const button of tabs.querySelectorAll('[data-entry-kind]')) {
      const selected = button.getAttribute('data-entry-kind') === activeKind
      button.setAttribute('aria-pressed', selected ? 'true' : 'false')
    }
    paint()
  }

  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-entry-kind]')
    if (!button) return
    writeEntryDraft(localStorage, member, activeKind, collect())
    activeKind = button.getAttribute('data-entry-kind')
    if (!ENTRY_KINDS[activeKind]) activeKind = 'character'
    paintForm()
    setStatus(`${ENTRY_KINDS[activeKind].label} form open — drafts stay on this device.`)
  })

  document.getElementById('enDownload')?.addEventListener('click', () => {
    const values = collect()
    const errors = validateEntryFields(activeKind, values)
    if (errors.length) {
      paintErrors(errors)
      setStatus(errors[0])
      return
    }
    const content = buildEntryMarkdown(activeKind, values)
    const name = entryDownloadName(activeKind, values)
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus(`Downloaded ${name} — hand it to Mikhail; nothing is filed until he approves.`)
  })

  document.getElementById('enCopy')?.addEventListener('click', async () => {
    const values = collect()
    const errors = validateEntryFields(activeKind, values)
    if (errors.length) {
      paintErrors(errors)
      setStatus(errors[0])
      return
    }
    const content = buildEntryMarkdown(activeKind, values)
    try {
      await navigator.clipboard.writeText(content)
      setStatus('Copied — paste it to Mikhail; nothing is filed until he approves.')
    } catch {
      const fallback = document.createElement('textarea')
      fallback.value = content
      document.body.appendChild(fallback)
      fallback.select()
      try {
        document.execCommand('copy')
        setStatus('Copied — paste it to Mikhail; nothing is filed until he approves.')
      } catch {
        setStatus('Copy was blocked — use Download .md instead, then hand it to Mikhail.')
      }
      fallback.remove()
    }
  })

  currentMemberEmail()
    .then(email => {
      member = email
      paintForm()
    })
    .catch(() => paintForm())
}

if (typeof document !== 'undefined') initEntry()
