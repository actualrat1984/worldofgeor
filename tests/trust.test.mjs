import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminHtml = readFileSync(path.join(root, 'public', 'admin.html'), 'utf8')
const dashboardHtml = readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8')

const OWNER = 'ichieisenheart@gmail.com'

// The server-side auth check (me.user.email !== owner) must keep working —
// strip that single logic line, then the visible gate copy must not leak it.
function adminVisibleCopy() {
  return adminHtml
    .split('\n')
    .filter(line => !line.includes('me.user.email !=='))
    .join('\n')
}

test('admin gate copy never names the owner address', () => {
  const visible = adminVisibleCopy()
  assert.ok(!visible.includes(OWNER), 'no owner address in admin visible copy')
  assert.ok(visible.includes('archive owner'), 'gate copy names the role, not the address')
})

test('admin gate denial keeps a login next step', () => {
  assert.ok(adminHtml.includes('GO LOGIN'), 'gate denial links onward to login')
  assert.ok(/reopen this page/i.test(adminHtml), 'gate denial tells the visitor what to do next')
})

test('trail button copy is honest about device-only clearing', () => {
  const match = dashboardHtml.match(/<button[^>]*id="clearTrail"[^>]*>([^<>]*)<\/button>/)
  assert.ok(match, 'clearTrail button exists')
  assert.equal(match[1], "Clear this device's trail")
  const tag = dashboardHtml.match(/<button[^>]*id="clearTrail"[^>]*>/)[0]
  assert.ok(/synced archive trail stays/i.test(tag), 'button title explains the synced trail persists')
})

test('dashboard carries exactly one pulse feed container', () => {
  const pulse = (dashboardHtml.match(/id="archivePulse"/g) || []).length
  const legacySince = (dashboardHtml.match(/id="newSinceVisit"/g) || []).length
  const legacyRecent = (dashboardHtml.match(/id="recentActivity"/g) || []).length
  assert.equal(pulse, 1, 'one archivePulse container')
  assert.equal(legacySince, 0, 'no leftover newSinceVisit container')
  assert.equal(legacyRecent, 0, 'no leftover recentActivity container')
})

test('single mark-seen still wires the archive-state seen action', () => {
  const buttons = (dashboardHtml.match(/id="markArchiveSeen"/g) || []).length
  assert.equal(buttons, 1, 'one mark-seen control')
  assert.ok(dashboardHtml.includes("api('/api/archive-state'"), 'seen POST preserved')
  assert.ok(dashboardHtml.includes("action:'seen'"), 'seen action preserved')
})

test('pulse feed merges unseen and recent motion with dedupe', () => {
  assert.ok(dashboardHtml.includes('recentMotion'), 'recent-motion source feeds the pulse')
  assert.ok(dashboardHtml.includes('syncedArchive?.unseen'), 'synced unseen feeds the pulse')
  assert.ok(dashboardHtml.includes('/api/updates'), 'pulse still reads the motion ledger')
})

test('every touched error string states what happened plus a next step', () => {
  const needsStep = [
    [/Charts unavailable — reload the page to try again/, 'admin charts fallback'],
    [/Charts unavailable — .*Reload the page to try again/, 'admin charts error'],
    [/The ledger is temporarily unavailable\. Reload the page or open the full ledger/, 'pulse error'],
    [/The archive count could not be refreshed\. Press Retry below/, 'coverage error'],
  ]
  for (const [pattern, label] of needsStep) {
    assert.ok(pattern.test(dashboardHtml + adminHtml), `${label} carries an action verb`)
  }
  assert.ok(dashboardHtml.includes('retry.onclick=()=>loadPulse()'), 'pulse error offers retry')
  assert.ok(dashboardHtml.includes('retry.onclick=loadWorldStats'), 'coverage error offers retry')
})
