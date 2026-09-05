// H12b: quest reward lines, per-member claim flags, status filters.
// Rewards parse from the thread's existing title (threads carry no
// note/body field) and never invent rows; claims live in member-keyed
// localStorage, visible only to the claiming member on that device and
// reversible; filters are client-side only. No worker/API/D1 change.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  QUEST_CLAIM_STORAGE_LABEL,
  QUEST_REWARD_MAX,
  QUEST_STATUS_FILTERS,
  QUEST_STATUS_FILTER_KEY,
  cleanQuestStatusFilter,
  filterQuestThreads,
  isQuestClaimed,
  parseQuestClaims,
  partitionQuestsByFilter,
  questClaimKey,
  questFilterMatches,
  questRewardOf,
  questTitleOf,
  readQuestClaims,
  renderQuestPosting,
  serializeQuestClaims,
  withQuestClaim,
  withoutQuestClaim,
  writeQuestClaims,
} from '../public/quests.js'

// In-memory Storage-like for claim round-trips.
function makeStore() {
  const data = new Map()
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: key => { data.delete(key) },
  }
}

test('rewards: parse the Reward marker from the existing title field', () => {
  assert.equal(questRewardOf({ title: 'Rescue the caravan — Reward: 200 gold' }), '200 gold')
  assert.equal(questRewardOf({ title: 'Reward: a silvered blade' }), 'a silvered blade')
  assert.equal(questRewardOf({ title: 'The seal  reward:   three nights’ shelter  ' }), 'three nights’ shelter')
  assert.equal(questRewardOf({ title: 'REWARD: 50 gold' }), '50 gold')
  assert.equal(questRewardOf({ title: 'The missing seal' }), '')
  assert.equal(questRewardOf({ title: '' }), '')
  assert.equal(questRewardOf({}), '')
  assert.equal(questRewardOf(null), '')
  // Bare marker promises nothing — empty reward, never invented.
  assert.equal(questRewardOf({ title: 'A quiet errand, Reward:' }), '')
  // Long rewards cap instead of sprawling the posting.
  const long = questRewardOf({ title: `Hold the gate — Reward: ${'g'.repeat(500)}` })
  assert.equal(long.length, QUEST_REWARD_MAX)
})

test('rewards: titles shed the reward tail; postings show a row only when one exists', () => {
  assert.equal(questTitleOf({ title: 'Rescue the caravan — Reward: 200 gold' }), 'Rescue the caravan')
  assert.equal(questTitleOf({ title: 'The missing seal' }), 'The missing seal')
  assert.equal(questTitleOf({}), '')
  const bare = renderQuestPosting({ id: 't0', title: 'Reward: 200 gold', state: 'seed' }, 'Ember Arc')
  assert.match(bare, /Untitled contract/)
  assert.match(bare, /Reward · 200 gold/)
  const plain = renderQuestPosting({ id: 't1', title: 'The missing seal', state: 'seed' }, 'Ember Arc')
  assert.doesNotMatch(plain, /data-quest-reward/)
  assert.doesNotMatch(plain, /Reward ·/)
  const rich = renderQuestPosting({ id: 't2', title: 'Hold the gate — Reward: 200 gold', state: 'active' }, 'Ember Arc')
  assert.match(rich, /data-quest-reward="t2"/)
  assert.match(rich, /Reward · 200 gold/)
  // The heading keeps the base title without duplicating the reward.
  assert.match(rich, /❧ Hold the gate</)
  assert.doesNotMatch(rich, /❧ Hold the gate — Reward/)
})

test('rewards: hostile markup in titles and rewards renders escaped', () => {
  const html = renderQuestPosting(
    { id: 't9', title: '<b>Fall</b> — Reward: <img src=x onerror=alert(1)>', state: 'seed' },
    'Ember <Arc>',
  )
  assert.doesNotMatch(html, /<b>Fall<\/b>/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&lt;b&gt;Fall&lt;\/b&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /Pinned under Ember &lt;Arc&gt;/)
})

test('claims: keys scope per member; round-trip per member and thread', () => {
  assert.equal(questClaimKey('Ada@Example.com'), questClaimKey('ada@example.com'))
  assert.notEqual(questClaimKey('ada@example.com'), questClaimKey('bob@example.com'))
  assert.equal(questClaimKey(''), questClaimKey(null))
  const store = makeStore()
  assert.deepEqual(readQuestClaims(store, 'ada@example.com'), [])
  assert.equal(writeQuestClaims(store, 'ada@example.com', ['t1']), true)
  assert.deepEqual(readQuestClaims(store, 'ada@example.com'), ['t1'])
  // Bob's key reads empty — Ada's mark is invisible to him.
  assert.deepEqual(readQuestClaims(store, 'bob@example.com'), [])
  assert.equal(isQuestClaimed(readQuestClaims(store, 'ada@example.com'), 't1'), true)
  assert.equal(isQuestClaimed(readQuestClaims(store, 'bob@example.com'), 't1'), false)
})

test('claims: reversible unclaim; hostile payloads read as no claims', () => {
  let ids = []
  ids = withQuestClaim(ids, 't1')
  ids = withQuestClaim(ids, 't2')
  assert.deepEqual(ids, ['t1', 't2'])
  assert.deepEqual(withQuestClaim(ids, 't1'), ['t1', 't2'])
  ids = withoutQuestClaim(ids, 't1')
  assert.deepEqual(ids, ['t2'])
  assert.equal(isQuestClaimed(ids, 't1'), false)
  assert.equal(isQuestClaimed(ids, 't2'), true)
  assert.deepEqual(withoutQuestClaim(ids, 'nope'), ['t2'])
  assert.deepEqual(parseQuestClaims('not json{{'), [])
  assert.deepEqual(parseQuestClaims('{"t1": true}'), [])
  assert.deepEqual(parseQuestClaims(null), [])
  assert.deepEqual(parseQuestClaims(['t1', '', 42, null, '  ', 't1']), ['t1'])
  assert.deepEqual(parseQuestClaims(['x'.repeat(500)]), [])
  assert.equal(serializeQuestClaims(['t1', 't1', '']), '["t1"]')
  // Blocked storage fails silent, never throws.
  assert.deepEqual(readQuestClaims(null, 'ada@example.com'), [])
  assert.deepEqual(readQuestClaims({ getItem() { throw new Error('blocked') } }, 'ada@example.com'), [])
  assert.equal(writeQuestClaims({ setItem() { throw new Error('blocked') } }, 'ada@example.com', ['t1']), false)
})

test('claims: posting buttons toggle per member, device-honest and reversible', () => {
  const thread = { id: 't1', title: 'The seal', state: 'seed' }
  const open = renderQuestPosting(thread, 'Ember Arc', { claimedIds: [] })
  assert.match(open, /data-claim-thread-id="t1" aria-pressed="false"/)
  assert.match(open, />CLAIM</)
  const marked = renderQuestPosting(thread, 'Ember Arc', { claimedIds: ['t1'] })
  assert.match(marked, /data-claim-thread-id="t1" aria-pressed="true"/)
  assert.match(marked, />CLAIMED — UNDO</)
  // Claims never leak across members: Bob's empty list renders unclaimed.
  assert.match(renderQuestPosting(thread, 'Ember Arc', { claimedIds: ['t9'] }), /aria-pressed="false"/)
  assert.match(marked, new RegExp(QUEST_CLAIM_STORAGE_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 20)))
})

test('filters: All, Open, Settled, and Claimed-by-me partition correctly', () => {
  const threads = [
    { id: 't1', title: 'Seed work', state: 'seed' },
    { id: 't2', title: 'Open work', state: 'active' },
    { id: 't3', title: 'Done work', state: 'resolved' },
    { id: 't4', title: 'Strange omen', state: 'mystery' },
  ]
  const claimed = ['t2', 't3']
  assert.deepEqual(filterQuestThreads(threads, 'all', claimed).map(t => t.id), ['t1', 't2', 't3', 't4'])
  assert.deepEqual(filterQuestThreads(threads, 'open', claimed).map(t => t.id), ['t1', 't2', 't4'])
  assert.deepEqual(filterQuestThreads(threads, 'settled', claimed).map(t => t.id), ['t3'])
  // Claimed-by-me spans states: open and settled marks both show.
  assert.deepEqual(filterQuestThreads(threads, 'claimed', claimed).map(t => t.id), ['t2', 't3'])
  assert.deepEqual(filterQuestThreads(threads, 'claimed', []), [])
  assert.deepEqual(filterQuestThreads(threads, 'bogus', claimed).map(t => t.id), ['t1', 't2', 't3', 't4'])
  assert.deepEqual(filterQuestThreads(null, 'open', claimed), [])
  assert.equal(cleanQuestStatusFilter('settled'), 'settled')
  assert.equal(cleanQuestStatusFilter('nope'), 'all')
  assert.equal(cleanQuestStatusFilter(null), 'all')
  assert.deepEqual([...QUEST_STATUS_FILTERS], ['all', 'open', 'settled', 'claimed'])
  assert.equal(QUEST_STATUS_FILTER_KEY, 'geor:quest-status-filter')
  assert.equal(questFilterMatches({ id: 't3', state: 'resolved' }, 'claimed', ['t3']), true)
  assert.equal(questFilterMatches({ id: 't1', state: 'seed' }, 'claimed', ['t3']), false)
})

test('filters: one pass splits per-arc boards and the settled rolls', () => {
  const byArc = new Map([
    ['a1', [{ id: 't1', state: 'seed' }, { id: 't2', state: 'resolved' }]],
    ['a2', [{ id: 't3', state: 'active' }]],
  ])
  const settled = [
    { thread: { id: 't2', state: 'resolved' }, arcTitle: 'Ember' },
    { thread: { id: 't9', state: 'resolved' }, arcTitle: 'Hollow' },
  ]
  const viewed = partitionQuestsByFilter(byArc, settled, 'claimed', ['t3', 't9'])
  assert.deepEqual(viewed.open.get('a1'), [])
  assert.deepEqual(viewed.open.get('a2').map(t => t.id), ['t3'])
  assert.deepEqual(viewed.settled.map(entry => entry.thread.id), ['t9'])
  const open = partitionQuestsByFilter(byArc, settled, 'open', [])
  assert.deepEqual(open.open.get('a1').map(t => t.id), ['t1'])
  assert.deepEqual(open.settled, [])
  const all = partitionQuestsByFilter(byArc, settled, 'all', [])
  assert.equal(all.open.get('a1').length, 2)
  assert.equal(all.settled.length, 2)
  assert.deepEqual(partitionQuestsByFilter(null, null, 'claimed', ['t1']).settled, [])
})

test('rewards shell: status chips and the device-honest claim note are mounted', () => {
  const html = readFileSync(new URL('../public/quests.html', import.meta.url), 'utf8')
  assert.match(html, /id="questStatusFilters"/)
  assert.match(html, /role="group" aria-label="Filter contracts by status"/)
  for (const mode of ['all', 'open', 'settled', 'claimed']) {
    assert.match(html, new RegExp(`data-quest-filter="${mode}"`), mode)
  }
  assert.match(html, /CLAIMED BY ME/)
  assert.match(html, /Claims stay on this device only — per member, per contract\./)
})

test('no invented rewards, no API or worker changes', () => {
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.doesNotMatch(workerSource, /\/api\/quests/)
  assert.doesNotMatch(workerSource, /quest-claims/)
  assert.doesNotMatch(workerSource, /quest_claims/)
  assert.doesNotMatch(workerSource, /QUEST_STATUS_FILTER/)
  const script = readFileSync(new URL('../public/quests.js', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /\/api\/quests/)
  assert.match(script, /localStorage/)
  assert.match(script, /\/api\/me/)
  assert.match(script, /QUEST_CLAIM_STORAGE_LABEL/)
  assert.match(script, /partitionQuestsByFilter/)
})
