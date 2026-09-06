// Lore Drops queue builder — vault gaps become the swipe deck.
// Reads the live vault (same PC), emits public/drops-queue.json.
// Deterministic: no invented canon. Every card quotes the actual gap.
// Usage: node scripts/build-drops-queue.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const VAULT = 'C:/Users/pc/Documents/Lore/Lore';
const OUT = join(ROOT, 'public', 'drops-queue.json');

const SKIP_DIRS = new Set(['_drafts', '_system', '.git', 'node_modules', 'chromadb']);
const STUB_LINES = 15;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function nonEmptyLines(text) {
  return text.split('\n').filter(l => l.trim().length > 0).length;
}

function baseName(p) {
  return p.slice(p.lastIndexOf(sep) + 1, -3);
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'untitled';
}

// What is already written — so the keeper can remember where a place is.
// Stubs are tiny by definition; fleshed files get their head only.
function excerptHead(text, maxLines, maxChars) {
  return text.split('\n').filter(l => l.trim().length > 0).slice(0, maxLines).join('\n').slice(0, maxChars);
}

function regionOf(p) {
  // World/Nations/<Region>/... -> <Region>
  const rel = relative(VAULT, p).split(sep);
  if (rel[0] === 'World' && rel[1] === 'Nations') return rel[2] || 'Erisdar';
  return null;
}

const cards = [];
const seen = new Set();
function push(card) {
  const key = card.kind + ':' + card.title;
  if (seen.has(key)) return;
  seen.add(key);
  card.id = `d-${card.kind}-${slugify(card.title)}`;
  cards.push(card);
}

// --- 1. Stub nations (<15 non-empty lines): flesh-out cards ---
const nations = walk(join(VAULT, 'World', 'Nations'));
const regionCounts = {};
for (const f of nations) {
  const region = regionOf(f) || 'Unknown';
  regionCounts[region] = (regionCounts[region] || 0) + 1;
  let text = '';
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const n = nonEmptyLines(text);
  if (n >= STUB_LINES) continue;
  const name = baseName(f);
  push({
    kind: 'nation',
    title: name,
    region,
    question: n <= 3
      ? `“${name}” is an empty page (${n} lines). Who lives there, and what do they want?`
      : `“${name}” is a stub (${n} lines). Give it one ruler, one custom, one conflict.`,
    context: `Nation file: World/Nations/${region}/${name}.md — ${n} non-empty lines.`,
    placeholder: `The people of ${name} are…`,
    existing: excerptHead(text, 40, 1500),
  });
}

// --- 2. Nations missing a Culture section: culture cards (cap 60, prefer fleshed files) ---
const noCulture = [];
for (const f of nations) {
  let text = '';
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (nonEmptyLines(text) < STUB_LINES) continue;
  if (/^##\s+Culture/m.test(text)) continue;
  noCulture.push({ f, head: excerptHead(text, 30, 1500) });
}
for (const { f, head } of noCulture.slice(0, 60)) {
  const name = baseName(f);
  const region = regionOf(f) || 'Unknown';
  push({
    kind: 'culture',
    title: `${name} culture`,
    region,
    question: `What do the people of ${name} eat, celebrate, and bury their dead with?`,
    context: `${name} (${region}) has no Culture section yet. Three lines is a kingdom.`,
    placeholder: `In ${name}, they…`,
    existing: head,
  });
}

// --- 3. Known orphans (Sep 5 audit): wire-up cards ---
const ORPHANS = [
  'Star Paladins of Mann', 'Silver Talon Guard', 'Armageddon',
  'Beaut', 'Ximpa',
];
for (const name of ORPHANS) {
  push({
    kind: 'orphan',
    title: `Link ${name}`,
    region: 'Vault-wide',
    question: `“${name}” has no inbound links — nothing points to it. Which nation, faith, or event should claim it, and why?`,
    context: `Orphan file flagged in the Sep 5 vault scan. Ruling wires it into the world.`,
    placeholder: `${name} belongs to…`,
  });
}
push({
  kind: 'orphan',
  title: 'Link the Arms pages',
  region: 'Vault-wide',
  question: `11 weapon pages under World/Military/Arms have zero inbound links. Which armies, orders, or wars forged them?`,
  context: `Orphan cluster flagged in the Sep 5 vault scan. One ruling wires all eleven.`,
  placeholder: `These arms were carried by…`,
});

// --- 4. Map names (597 AGD loose ends): rule cards ---
const MAPS = [
  ['Dunmorrow', 'Violin-shaped tan island, south near the pale shelf. Proposed: Dunmorrow.'],
  ['Eburne', 'Beige amoeba island beside it. Proposed: Eburne.'],
  ['Emberfold', 'Orange north coast of Kobre with no nation. Proposed: Emberfold — or fold into Coalsteel as “the Burned Shore”.'],
  ['Frosthooks', 'Great hooked glaciated archipelago, uninhabited. Proposed: Frosthooks.'],
  ['Whitespire Island', 'Glacier island with a white ice-spire. Proposed: Whitespire Island.'],
  ['Winter Coast', 'Cut label near Romanium Island (“…TER COAST”). Proposed: Winter Coast.'],
];
for (const [name, detail] of MAPS) {
  push({
    kind: 'map',
    title: `Name ${name}`,
    region: 'Cartography',
    question: `${detail} Confirm the name — or give a better one and one line of why.`,
    context: `597 AGD map loose end. The border becomes canon the moment it is ruled.`,
    placeholder: `It shall be called…`,
  });
}

// --- 5. Thin ages: age cards ---
const AGES = [
  ['Age 0', 'The Lost Era — 15,000 years nearly blank.'],
  ['Age 1', 'First Tribes — who walked first?'],
  ['Age 2', 'First Empires — who crowned first?'],
  ['Age 3', 'Dragon Tyranny — what did Baoth demand?'],
  ['Age 10', 'Late fracture — what cracked?'],
  ['Age 11', 'The present (597 AGD) — what defines right now?'],
  ['Age 12', 'The Strife, unwritten future — what is coming?'],
];
for (const [name, detail] of AGES) {
  push({
    kind: 'age',
    title: `Open ${name}`,
    region: 'Timeline',
    question: `${detail} Give this age one event, one name history remembers.`,
    context: `Thin age flagged on the backlog board. One ruling opens it.`,
    placeholder: `In ${name}, …`,
  });
}

// --- 6. Count rulings: computed live, never guessed ---
for (const [region, count] of Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  push({
    kind: 'count',
    title: `Survey ${region}`,
    region,
    question: `The archive holds ${count} nation files for ${region}. How many are true sovereigns — and which one matters most?`,
    context: `Live count from the vault, computed at deck build. The ruling is yours.`,
    placeholder: `Of these, …`,
  });
}

const payload = {
  generated: new Date().toISOString(),
  vault: VAULT,
  count: cards.length,
  kinds: [...new Set(cards.map(c => c.kind))],
  cards,
};
writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log(`drops-queue: ${cards.length} cards -> ${OUT}`);
for (const k of payload.kinds) {
  console.log(`  ${k}: ${cards.filter(c => c.kind === k).length}`);
}
