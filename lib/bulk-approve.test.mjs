/**
 * BULK APPROVAL STOPS AT THE FIRST REFUSAL, AND SAYS WHERE.
 *
 * The failure this guards against is a bulk action that carries on past a
 * refusal: the queue ends up half-applied and the reviewer is told a number,
 * leaving them to work out which rows landed by reading the database. Partial
 * application is a fact about the world — the only question is whether it is
 * visible, and these tests are what keep it visible.
 *
 * Tested with a fake approver rather than a database, because the thing being
 * tested is the SEQUENCING, not the SQL. approve_change's own rules are
 * covered in supabase/tests/rls_test.sql, where they can be checked against a
 * real transaction.
 *
 *   node --test lib/bulk-approve.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { approveSequentially, describeBulkResult } from './bulk-approve.ts'

/** Approves everything, recording call order. */
const allOk = (calls) => async (id) => {
  calls.push(id)
  return { ok: true, slug: `room-${id}` }
}

/** Refuses exactly one id, recording call order. */
const failOn = (calls, badId, error = 'refused') => async (id) => {
  calls.push(id)
  if (id === badId) return { ok: false, error }
  return { ok: true, slug: `room-${id}` }
}

test('every row applying reports them all and no stop', async () => {
  const calls = []
  const r = await approveSequentially(['a', 'b', 'c'], allOk(calls))
  assert.deepEqual(calls, ['a', 'b', 'c'])
  assert.equal(r.approved, 3)
  assert.equal(r.stoppedAt, null)
  assert.equal(r.unattempted, 0)
})

test('a refusal stops the run and names the row and the reason', async () => {
  const calls = []
  const r = await approveSequentially(['a', 'b', 'c', 'd'], failOn(calls, 'b', 'targets a verified fact'))
  assert.equal(r.approved, 1)
  assert.equal(r.stoppedAt.id, 'b')
  assert.equal(r.stoppedAt.error, 'targets a verified fact')
})

test('THE ROWS BEHIND A REFUSAL ARE NEVER ATTEMPTED', async () => {
  /* The whole point of stopping. If c and d were tried anyway, the run would
     be a filter rather than a stop, and "half-applied" would be silent. */
  const calls = []
  await approveSequentially(['a', 'b', 'c', 'd'], failOn(calls, 'b'))
  assert.deepEqual(calls, ['a', 'b'])
})

test('the failing row counts as attempted, not as unattempted', async () => {
  const r = await approveSequentially(['a', 'b', 'c', 'd'], failOn([], 'b'))
  /* 4 rows: a applied, b refused, c and d never got a turn. */
  assert.equal(r.unattempted, 2)
  assert.equal(r.approved + 1 + r.unattempted, 4)
})

test('a refusal on the very first row applies nothing', async () => {
  const r = await approveSequentially(['a', 'b'], failOn([], 'a'))
  assert.equal(r.approved, 0)
  assert.equal(r.stoppedAt.index, 0)
  assert.equal(r.unattempted, 1)
})

test('slugs are collected once each, for revalidation', async () => {
  const r = await approveSequentially(['a', 'b'], async () => ({ ok: true, slug: 'wynn-encore' }))
  assert.deepEqual(r.slugs, ['wynn-encore'])
})

test('a null slug does not enter the revalidation list', async () => {
  const r = await approveSequentially(['a'], async () => ({ ok: true, slug: null }))
  assert.deepEqual(r.slugs, [])
})

test('an empty queue is not an error', async () => {
  const r = await approveSequentially([], allOk([]))
  assert.equal(r.approved, 0)
  assert.equal(r.stoppedAt, null)
})

test('the message a reviewer reads states partial application explicitly', async () => {
  const r = await approveSequentially(['a', 'b', 'c'], failOn([], 'b', 'verified in person'))
  const msg = describeBulkResult(r, 'the partner sheet')
  /* Naming the position, the reason and the remainder is the difference
     between a report and a number. */
  assert.match(msg, /Stopped at row 2/)
  assert.match(msg, /verified in person/)
  assert.match(msg, /1 proposal applied before it/)
  assert.match(msg, /1 not attempted/)
  assert.match(msg, /partly applied/)
})

test('a clean run names the source and does not mention stopping', async () => {
  const r = await approveSequentially(['a', 'b'], allOk([]))
  const msg = describeBulkResult(r, 'the partner sheet')
  assert.equal(msg, 'Applied 2 proposals from the partner sheet.')
  assert.doesNotMatch(msg, /Stopped/)
})

test('one proposal is singular', async () => {
  const r = await approveSequentially(['a'], allOk([]))
  assert.match(describeBulkResult(r, 'x'), /Applied 1 proposal from/)
})
