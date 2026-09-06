// H14 half 2: shared-boards UI — pure helpers only (no browser, no fetch).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canEditBoard,
  formatSharedDate,
  renderSharedBoardItem,
  renderSharedBoardList,
  shareResultText,
} from '../public/boards.js'

test('shared list renders empty and populated states', () => {
  assert.match(renderSharedBoardList([], null), /No boards shared with you yet/)
  assert.match(renderSharedBoardList(null, null), /No boards shared with you yet/)
  const html = renderSharedBoardList([
    { id: 's1', title: 'Ember plot', updated_at: '2026-09-01T10:00:00.000Z', granted_by: 'owner@example.com' },
    { id: 's2', title: 'Ash schemes', updated_at: '2026-09-02T10:00:00.000Z', granted_by: 'owner@example.com' },
  ], 's1')
  assert.match(html, /Ember plot/)
  assert.match(html, /Ash schemes/)
  assert.match(html, /2026-09-01/)
  assert.match(html, /SHARED BOARD/i)
  assert.match(html, /data-shared="true"/)
  assert.match(html, /aria-pressed="true"/)
})

test('shared rows never show the owner email', () => {
  const html = renderSharedBoardList([
    { id: 's1', title: 'Ember plot', updated_at: '2026-09-01T10:00:00.000Z', granted_by: 'secret-owner@example.com' },
  ], null)
  assert.doesNotMatch(html, /secret-owner@example\.com/)
  assert.doesNotMatch(html, /granted_by/)
  assert.match(renderSharedBoardItem({ id: 's9', title: '', updated_at: null, granted_by: 'x@y.z' }, false), /Untitled board/)
})

test('shared rows escape hostile titles, ids, and dates', () => {
  const html = renderSharedBoardList([
    { id: '"><img src=x onerror=alert(1)>', title: '<script>alert("x")</script>', updated_at: '2026-09-01T10:00:00.000Z', granted_by: 'a@b.c' },
  ], null)
  assert.doesNotMatch(html, /<script>/)
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;script&gt;/)
  const emailProbe = renderSharedBoardItem({ id: 's1', title: '<b>bold</b>', updated_at: 'not-a-date', granted_by: '<img src=x>' }, false)
  assert.doesNotMatch(emailProbe, /<b>/)
  assert.doesNotMatch(emailProbe, /<img/)
  assert.match(emailProbe, /&lt;b&gt;bold&lt;\/b&gt;/)
})

test('read-only flag disables editing only for shared view', () => {
  assert.equal(canEditBoard('owned'), true)
  assert.equal(canEditBoard('shared'), false)
  assert.equal(canEditBoard(undefined), false)
  assert.equal(canEditBoard(null), false)
  assert.equal(canEditBoard(''), false)
})

test('share result text is plain and trims input', () => {
  assert.equal(shareResultText('shared', 'ada@example.com'), 'Shared with ada@example.com')
  assert.equal(shareResultText('revoked', '  bob@example.com  '), 'Removed bob@example.com')
  assert.equal(shareResultText('shared', ''), 'Shared with that address')
  assert.equal(shareResultText('shared', '<script>'), 'Shared with <script>')
})

test('formatSharedDate keeps date-only output and rejects junk', () => {
  assert.equal(formatSharedDate('2026-09-01T10:00:00.000Z'), '2026-09-01')
  assert.equal(formatSharedDate('garbage'), '')
  assert.equal(formatSharedDate(null), '')
  assert.equal(formatSharedDate(undefined), '')
})

test('pure helpers never fetch and never invent endpoints', () => {
  for (const fn of [renderSharedBoardItem, renderSharedBoardList, canEditBoard, shareResultText, formatSharedDate]) {
    assert.doesNotMatch(fn.toString(), /fetch/)
    assert.doesNotMatch(fn.toString(), /\/api\/boards/)
  }
  const source = readFileSync(new URL('../public/boards.js', import.meta.url), 'utf8')
  const helperSection = source.slice(0, source.indexOf('// One card on the canvas'))
  assert.doesNotMatch(helperSection, /fetch\(/)
  assert.doesNotMatch(helperSection, /\/api\/boards\/shared/)
  assert.doesNotMatch(helperSection, /\/shares/)
})
