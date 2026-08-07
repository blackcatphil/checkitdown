/**
 * THE SORT IS THE PRODUCT DECISION, so it is tested away from the page.
 *
 * Precedence is by RECENCY OF HUMAN CHECK, not by source class. A scrape that
 * contradicts a person-verified fact is usually the scraper being wrong — but
 * if it was taken AFTER the person looked, it is the room having changed, which
 * is the entire reason this product exists. Burying those under high-confidence
 * routine corrections would hide the only rows that can teach us something the
 * partner does not already know.
 *
 *   node --test lib/review-order.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isStaleVerification, orderQueue } from './review-order.ts'

const row = (id, { fetched, verified = null, confidence = 0.5, created = '2026-08-01T00:00:00Z' }) => ({
  id, fetched_at: fetched, fact_verified_at: verified, confidence, created_at: created,
})

test('a scrape taken after the floor visit is flagged stale', () => {
  assert.equal(isStaleVerification('2026-08-06T00:00:00Z', '2026-08-01T00:00:00Z'), true)
})

test('a scrape taken before the floor visit is NOT stale — the visit still stands', () => {
  assert.equal(isStaleVerification('2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z'), false)
})

test('an unverified fact is never "stale verification" — there is no visit to be later than', () => {
  assert.equal(isStaleVerification('2026-08-06T00:00:00Z', null), false)
})

test('scrape-newer-than-verification outranks everything, including higher confidence', () => {
  const out = orderQueue([
    row('routine', { fetched: '2026-08-06T00:00:00Z', confidence: 0.99 }),
    row('stale', { fetched: '2026-08-06T00:00:00Z', verified: '2026-08-01T00:00:00Z', confidence: 0.10 }),
  ])
  assert.deepEqual(out.map((r) => r.id), ['stale', 'routine'],
    'a 0.10-confidence row that contradicts a stale floor visit is the most valuable row on the page')
})

test('among equals, higher confidence first', () => {
  const out = orderQueue([
    row('low', { fetched: '2026-08-06T00:00:00Z', confidence: 0.2 }),
    row('high', { fetched: '2026-08-06T00:00:00Z', confidence: 0.9 }),
  ])
  assert.deepEqual(out.map((r) => r.id), ['high', 'low'])
})

test('confidence ties break by age, oldest first — a queue is not a stack', () => {
  const out = orderQueue([
    row('newer', { fetched: '2026-08-06T00:00:00Z', created: '2026-08-05T00:00:00Z' }),
    row('older', { fetched: '2026-08-06T00:00:00Z', created: '2026-08-02T00:00:00Z' }),
  ])
  assert.deepEqual(out.map((r) => r.id), ['older', 'newer'])
})

test('a missing confidence sorts below a stated one rather than throwing', () => {
  const out = orderQueue([
    row('none', { fetched: '2026-08-06T00:00:00Z', confidence: null }),
    row('some', { fetched: '2026-08-06T00:00:00Z', confidence: 0.4 }),
  ])
  assert.deepEqual(out.map((r) => r.id), ['some', 'none'])
})

test('the input array is not reordered in place', () => {
  const input = [
    row('a', { fetched: '2026-08-06T00:00:00Z', confidence: 0.1 }),
    row('b', { fetched: '2026-08-06T00:00:00Z', confidence: 0.9 }),
  ]
  orderQueue(input)
  assert.deepEqual(input.map((r) => r.id), ['a', 'b'], 'sorting a prop array in place is a rendering bug waiting to happen')
})
