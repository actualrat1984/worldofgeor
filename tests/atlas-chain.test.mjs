// Wave C3a — pin→article gate + folio-chaining registry. Mirrors the
// chronicles hostile-URL list: hostile pin urls must never render.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FOLIO_REGISTRY,
  chainUiVisible,
  childFolios,
  parentFolio,
  pinArticleUrl,
  pinFolioTarget,
} from '../public/atlas-chain.js'

test('pinArticleUrl passes safe /wiki/ urls, drops hostile values', () => {
  assert.equal(
    pinArticleUrl({ url: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' }),
    '/wiki/World/Nations/Dissenbarg/Dissenbarg/',
  )
  for (const bad of [
    'javascript:alert(1)',
    'https://evil.example/wiki/World/Nations/Dissenbarg/',
    '/evil',
    '/wiki',
    '/wiki/',
    '/wiki/../secret',
    '/wiki/World\\\\Nations',
    '',
    null,
    undefined,
    42,
    { url: '/wiki/World/Nations/Dissenbarg/' },
  ]) {
    assert.equal(pinArticleUrl({ url: bad }), null, String(bad))
  }
  assert.equal(pinArticleUrl({}), null)
  assert.equal(pinArticleUrl(null), null)
  assert.equal(pinArticleUrl(undefined), null)
})

test('pinFolioTarget only resolves registered folios', () => {
  assert.equal(pinFolioTarget({ folio: 'grimmel' }), 'grimmel')
  assert.equal(pinFolioTarget({ folio: 'erisdar' }), 'erisdar')
  for (const bad of ['nowhere', 'https://evil.example/', '', null, undefined, 42]) {
    assert.equal(pinFolioTarget({ folio: bad }), null, String(bad))
  }
  assert.equal(pinFolioTarget({}), null)
  assert.equal(pinFolioTarget(null), null)
})

test('folio registry chains world down and back up', () => {
  assert.deepEqual(childFolios('world'), ['grimmel', 'erisdar'])
  assert.deepEqual(childFolios('grimmel'), [])
  assert.equal(parentFolio('grimmel'), 'world')
  assert.equal(parentFolio('erisdar'), 'world')
  assert.equal(parentFolio('world'), null)
  assert.deepEqual(childFolios('nowhere'), [])
  assert.equal(parentFolio('nowhere'), null)
})

test('chain UI hides on an empty registry — no dead buttons', () => {
  assert.equal(chainUiVisible(FOLIO_REGISTRY), true)
  assert.equal(chainUiVisible({}), false)
  assert.equal(chainUiVisible(null), false)
  // Explicit undefined falls back to the default registry (JS default
  // parameters) — so it shows the real chain, never an empty box.
  assert.equal(chainUiVisible(undefined), true)
  assert.deepEqual(childFolios('world', {}), [])
  assert.equal(parentFolio('grimmel', {}), null)
  assert.equal(pinFolioTarget({ folio: 'grimmel' }, {}), null)
})
