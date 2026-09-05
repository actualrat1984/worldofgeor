// Wave H22: editor role + guarded review queue. Pure transition matrix,
// role cleaner, grouping, honest labels, hostile escaping, and room wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { __test } from '../worker.js'
import {
  REVIEW_STATUSES,
  actionsFor,
  describeRole,
  groupWorkflowItems,
  nextStepFor,
  renderQueueGroup,
  renderQueueItem,
  roleBadge,
  transitionError,
} from '../public/review.js'

const { canTransitionItem, cleanRole } = __test
assert.equal(typeof canTransitionItem, 'function', 'worker exports pure canTransitionItem')
assert.equal(typeof cleanRole, 'function', 'worker exports cleanRole')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workerSource = readFileSync(path.join(root, 'worker.js'), 'utf8')
const reviewSrc = readFileSync(path.join(root, 'public', 'review.js'), 'utf8')
const reviewHtml = readFileSync(path.join(root, 'public', 'review.html'), 'utf8')
const dashboardHtml = readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8')
const compassSrc = readFileSync(path.join(root, 'public', 'archive-compass.js'), 'utf8')
const checkSiteSrc = readFileSync(path.join(root, 'scripts', 'check-site.mjs'), 'utf8')

const OWNER = { isOwner: true, isEditor: false, isAuthor: false }
const OWNER_AUTHOR = { isOwner: true, isEditor: false, isAuthor: true }
const EDITOR_AUTHOR = { isOwner: false, isEditor: true, isAuthor: true }
const EDITOR_STRANGER = { isOwner: false, isEditor: true, isAuthor: false }
const VIEWER_AUTHOR = { isOwner: false, isEditor: false, isAuthor: true }
const VIEWER_STRANGER = { isOwner: false, isEditor: false, isAuthor: false }

test('draft→review by author, editor, or owner — never by a stranger viewer', () => {
  assert.equal(canTransitionItem('draft', 'review', VIEWER_AUTHOR), true)
  assert.equal(canTransitionItem('draft', 'review', EDITOR_AUTHOR), true)
  assert.equal(canTransitionItem('draft', 'review', EDITOR_STRANGER), true)
  assert.equal(canTransitionItem('draft', 'review', OWNER), true)
  assert.equal(canTransitionItem('draft', 'review', VIEWER_STRANGER), false)
})

test('editor-cannot-approve: review→approved and approved→published are owner-only', () => {
  assert.equal(canTransitionItem('review', 'approved', OWNER), true)
  assert.equal(canTransitionItem('review', 'approved', EDITOR_AUTHOR), false)
  assert.equal(canTransitionItem('review', 'approved', EDITOR_STRANGER), false)
  assert.equal(canTransitionItem('review', 'approved', VIEWER_AUTHOR), false)
  assert.equal(canTransitionItem('approved', 'published', OWNER), true)
  assert.equal(canTransitionItem('approved', 'published', EDITOR_AUTHOR), false)
  assert.equal(canTransitionItem('approved', 'published', OWNER_AUTHOR), true)
  assert.equal(canTransitionItem('approved', 'published', VIEWER_STRANGER), false)
})

test('non-author-cannot-rework: any→draft by author or owner only', () => {
  for (const from of ['review', 'approved', 'published']) {
    assert.equal(canTransitionItem(from, 'draft', VIEWER_AUTHOR), true, `${from}→draft author`)
    assert.equal(canTransitionItem(from, 'draft', OWNER), true, `${from}→draft owner`)
    assert.equal(canTransitionItem(from, 'draft', EDITOR_STRANGER), false, `${from}→draft editor stranger`)
    assert.equal(canTransitionItem(from, 'draft', VIEWER_STRANGER), false, `${from}→draft viewer stranger`)
  }
  assert.equal(canTransitionItem('review', 'draft', EDITOR_AUTHOR), true, 'editor who filed it may rework')
})

test('owner-supreme on every legal move, denied on skips, no-ops, and junk', () => {
  assert.equal(canTransitionItem('draft', 'review', OWNER), true)
  assert.equal(canTransitionItem('review', 'draft', OWNER), true)
  assert.equal(canTransitionItem('review', 'approved', OWNER), true)
  assert.equal(canTransitionItem('approved', 'published', OWNER), true)
  assert.equal(canTransitionItem('draft', 'approved', OWNER), false, 'no skips')
  assert.equal(canTransitionItem('draft', 'published', OWNER), false, 'no skips')
  assert.equal(canTransitionItem('review', 'published', OWNER), false, 'no skips')
  assert.equal(canTransitionItem('draft', 'draft', OWNER), false, 'no no-ops')
  assert.equal(canTransitionItem('bogus', 'review', OWNER), false, 'junk from')
  assert.equal(canTransitionItem('draft', 'bogus', OWNER), false, 'junk to')
  assert.equal(canTransitionItem('draft', 'review', null), false, 'missing access denies')
  assert.equal(canTransitionItem('draft', 'review', {}), false, 'empty access denies')
})

test('role cleaner accepts exactly viewer/editor/owner and rejects junk', () => {
  assert.equal(cleanRole('viewer'), 'viewer')
  assert.equal(cleanRole('editor'), 'editor')
  assert.equal(cleanRole('owner'), 'owner')
  for (const junk of ['admin', 'Owner', 'EDITOR', '', 'superuser', null, undefined, 42, 'viewer ']) {
    assert.equal(cleanRole(junk), null, `rejects ${JSON.stringify(junk)}`)
  }
})

test('queue groups bucket every legal state and drop hostile states', () => {
  const groups = groupWorkflowItems([
    { id: 'a', status: 'draft' },
    { id: 'b', status: 'review' },
    { id: 'c', status: 'approved' },
    { id: 'd', status: 'published' },
    { id: 'evil', status: '<img src=x onerror=alert(1)>' },
    { id: 'nostatus' },
    null,
  ])
  assert.deepEqual(Object.keys(groups).sort(), ['approved', 'draft', 'published', 'review'])
  assert.equal(groups.draft.length, 1)
  assert.equal(groups.review.length, 1)
  assert.equal(groups.approved.length, 1)
  assert.equal(groups.published.length, 1)
  assert.deepEqual(groupWorkflowItems(null), { draft: [], review: [], approved: [], published: [] })
})

test('hostile titles, ids, and states are escaped in queue output', () => {
  const evil = { id: '"><svg onload=alert(1)>', title: '<img src=x onerror=alert(1)>', status: 'review', created_by: 'a@b.c' }
  const html = renderQueueItem(evil, { email: 'me@x.y' })
  assert.ok(!html.includes('<img src=x'), 'raw hostile markup never renders')
  assert.ok(!html.includes('<svg onload'), 'raw hostile id never renders')
  assert.ok(html.includes('&lt;img'), 'hostile title is entity-escaped')
  const group = renderQueueGroup('review', [evil], { email: 'me@x.y' }, null)
  assert.ok(group.includes('&lt;img'), 'group rendering escapes too')
})

test('role labels are honest: least privilege unless verified', () => {
  assert.equal(describeRole(OWNER), 'owner')
  assert.equal(describeRole(EDITOR_STRANGER), 'editor')
  assert.equal(describeRole(VIEWER_STRANGER), 'viewer')
  assert.equal(describeRole(null), 'viewer')
  assert.equal(describeRole({}), 'viewer')
  assert.match(roleBadge(OWNER), /Owner/)
  assert.match(roleBadge(EDITOR_STRANGER), /Editor/)
  assert.match(roleBadge(VIEWER_STRANGER), /Viewer/)
  assert.ok(!roleBadge(VIEWER_STRANGER).includes('Owner'), 'viewers are never labeled owner')
})

test('next-step errors name the true gate for every guarded move', () => {
  assert.match(transitionError('review', 'approved'), /archive owner/)
  assert.match(transitionError('approved', 'published'), /archive owner/)
  assert.match(transitionError('review', 'draft'), /author or the archive owner/)
  for (const status of REVIEW_STATUSES) {
    assert.ok(nextStepFor(status).length > 0, `${status} has next-step copy`)
  }
  assert.deepEqual(actionsFor('bogus'), [], 'hostile states offer no actions')
})

test('worker wires the guard: roles endpoint, transition gate, forced drafts', () => {
  assert.match(workerSource, /\/api\/roles/, 'POST /api/roles exists')
  assert.match(workerSource, /canTransitionItem\(existing\.status, transitionStatus/, 'transition path calls the pure gate')
  assert.match(workerSource, /Access denied/, 'denials are generic (no role enumeration)')
  assert.match(workerSource, /status = 'draft'/, 'non-owner creates are forced to draft')
  const rolesBlock = workerSource.slice(workerSource.indexOf('/api/roles'), workerSource.indexOf('/api/roles') + 1800)
  assert.ok(!rolesBlock.match(/\{\s*users\s*:/), 'roles endpoint never returns a user list')
})

test('review room is wired: compass, dashboard, check-site alias, queue page', () => {
  assert.ok(compassSrc.includes("url: '/review'"), 'compass lists the review room')
  assert.ok(dashboardHtml.includes('href="/review"'), 'dashboard links the review room')
  assert.ok(dashboardHtml.includes('REVIEW QUEUE'), 'dashboard card names the review room')
  assert.match(checkSiteSrc, /\['\/review', '\/review\.html'\]/, 'check-site aliases /review')
  assert.ok(existsSync(path.join(root, 'public', 'review.html')), 'review.html ships')
  assert.ok(existsSync(path.join(root, 'public', 'review.js')), 'review.js ships')
  assert.ok(reviewHtml.includes('/review.js'), 'review page loads its script')
  assert.ok(reviewHtml.includes('q-draft') && reviewHtml.includes('q-published'), 'review page groups every state')
  assert.ok(reviewSrc.includes('/api/workflow') && reviewSrc.includes('?status='), 'queue reads per-status workflow feeds')
})
