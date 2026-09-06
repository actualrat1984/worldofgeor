// Lore Drops pure-logic tests — paths, sessions, shuffle, queue shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, sessionKey, fitSanitize, nextSessionN, pad2,
  buildDropPath, shuffled, swappedOrder, validateQueue, kindLabel, kindArt, buildDropBody,
} from '../public/drops.js';

test('slugify makes safe short slugs', () => {
  assert.equal(slugify('Emberfold Coast!'), 'emberfold-coast');
  assert.equal(slugify('  ...  '), 'untitled');
  assert.ok(slugify('A'.repeat(200)).length <= 48);
});

test('session keys and counters roll per day', () => {
  assert.equal(sessionKey('2026-09-06'), 'geor-drops-2026-09-06');
  assert.equal(nextSessionN('2026-09-06', 3, '2026-09-06'), 4);
  assert.equal(nextSessionN('2026-09-05', 9, '2026-09-06'), 1);
  assert.equal(nextSessionN(null, 0, '2026-09-06'), 1);
  assert.equal(pad2(3), '03');
});

test('drop paths fit the worker sanitize limits', () => {
  const p = buildDropPath('2026-09-06', 3, '143522', 'Emberfold Coast');
  assert.equal(p, 'drops/2026-09-06/s03/143522-emberfold-coast.md');
  assert.ok(fitSanitize(p));
  const long = buildDropPath('2026-09-06', 3, '143522', 'A'.repeat(200));
  assert.ok(long && long.length <= 180); // 48-char slug cap keeps any title fittable
  assert.ok(!fitSanitize('drops/2026-09-06/s03/' + 'a'.repeat(200) + '.md'));
  assert.ok(!fitSanitize('drops/../evil.md'));
  assert.ok(!fitSanitize('/absolute.md'));
});

test('shuffle keeps every card, order varies with seed', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const seq = [0.1, 0.9, 0.4];
  let i = 0;
  const out = shuffled(cards, () => seq[i++ % seq.length]);
  assert.deepEqual(out.map(c => c.id).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(cards.map(c => c.id), ['a', 'b', 'c', 'd']); // no mutation
});

test('queue validation catches bad decks', () => {
  assert.equal(validateQueue({ cards: [] }), 'queue is empty');
  assert.equal(validateQueue(null), 'queue.cards missing');
  assert.equal(validateQueue({ cards: [{ id: 'x' }] }), 'card missing kind');
  assert.equal(validateQueue({ cards: [{ id: 'x', kind: 'k', title: 't', question: 'q' }] }), null);
});

test('labels, art, and drop body carry the ruling', () => {
  assert.equal(kindLabel('map'), 'MAP RULING');
  assert.equal(kindLabel('???'), 'LORE GAP');
  assert.equal(kindArt('nation'), '/drops-art/drops-nation.webp');
  const card = { id: 'd-map-x', kind: 'map', title: 'Emberfold', question: 'Name it?', context: 'ctx' };
  const body = buildDropBody(card, '  It burns. ', { date: '2026-09-06', sessionN: 3 });
  assert.ok(body.includes('# Emberfold'));
  assert.ok(body.includes('It burns.'));
  assert.ok(body.includes('session: s03'));
  assert.ok(body.includes('card: d-map-x'));
});

test('swap trades places with the coming card only', () => {
  const o = ['a', 'b', 'c'];
  assert.deepEqual(swappedOrder(o, 0), ['b', 'a', 'c']);
  assert.deepEqual(o, ['a', 'b', 'c']); // no mutation
  assert.deepEqual(swappedOrder(o, 2), ['a', 'b', 'c']); // nothing behind
  assert.deepEqual(swappedOrder(o, -1), ['a', 'b', 'c']);
});

test('queue cards may carry existing archive text', () => {
  const err = validateQueue({ cards: [{ id: 'x', kind: 'nation', title: 'T', question: 'Q', existing: 'Once…' }] });
  assert.equal(err, null);
});
