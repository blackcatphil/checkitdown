/**
 * Pins the invariant that was previously true only by accident of elsewhere.
 *
 *   node --test lib/game-filter.test.mjs
 *
 * The old guarantee was "a gated key cannot reach `checked`, because `checked`
 * is never restored from the URL or localStorage". True today, resting on a fact
 * about a different file, and failing silently the day someone adds shareable
 * filter state. These assertions hold regardless of how a key arrives.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyGameFilter, shippableKeys, visibleFilters } from './game-filter.ts'

/* 'mixed' deliberately has no room behind it — the real coverage gap that made
   "Mixed games — 0" a dead control on screen. */
const ROOMS = [
  { slug: 'a', games: ['nlh', 'plo'] },
  { slug: 'b', games: ['nlh', 'limit'] },
  { slug: 'c', games: ['nlh'] },
]

test('a key with no rooms behind it is not offered', () => {
  assert.deepEqual([...shippableKeys(ROOMS)].sort(), ['limit', 'nlh', 'plo'])
  assert.ok(!visibleFilters(ROOMS).some(([k]) => k === 'mixed'))
})

test('the gate reacts to the roster, not to a hand-maintained constant', () => {
  const withMixed = [...ROOMS, { slug: 'd', games: ['mixed'] }]
  assert.ok(visibleFilters(withMixed).some(([k]) => k === 'mixed'))
})

test('a gated key cannot filter, however it arrives in `checked`', () => {
  // This is the case the old arrangement could not survive: a stale key from a
  // shared URL, restored storage, or a hand-edited query string.
  const { matches, activeKeys, dropped } = applyGameFilter(ROOMS, ['mixed'])
  assert.equal(matches.length, ROOMS.length, 'a gated key must not narrow the set')
  assert.deepEqual(activeKeys, [])
  assert.deepEqual(dropped, ['mixed'], 'and the drop is reported, not silent')
})

test('a gated key mixed with a real one drops only itself', () => {
  const { matches, dropped } = applyGameFilter(ROOMS, ['limit', 'mixed'])
  assert.deepEqual(matches.map((r) => r.slug), ['b'])
  assert.deepEqual(dropped, ['mixed'])
})

test('AND logic across real keys is unchanged', () => {
  assert.deepEqual(applyGameFilter(ROOMS, ['nlh']).matches.map((r) => r.slug), ['a', 'b', 'c'])
  assert.deepEqual(applyGameFilter(ROOMS, ['nlh', 'plo']).matches.map((r) => r.slug), ['a'])
  assert.deepEqual(applyGameFilter(ROOMS, []).matches.length, ROOMS.length)
})

test('an unknown key is dropped too, not treated as a miss', () => {
  // Filtering on a key nothing defines would otherwise empty the map — an
  // absence of matches presented as a real result.
  const { matches, dropped } = applyGameFilter(ROOMS, ['stud'])
  assert.equal(matches.length, ROOMS.length)
  assert.deepEqual(dropped, ['stud'])
})
