import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cellFor, composite, firstReadingOn, isoWeekStart, isFault, readingDateLabel, render,
} from './growth-absence.ts'

/**
 * ⚠️ THE ASSERTION THE CONSOLE EXISTS FOR.
 *
 * Every other gate in this repo protects a pipeline. This one protects the
 * MEANING of a number on a screen somebody makes decisions from. The three
 * failures it exists to make impossible:
 *
 *   · a cell renders 0 where its query returned no rows
 *       → "we measured, the answer is none" about a week nobody has measured
 *   · a cell renders a date where no producer exists
 *       → a deadline for a thing nobody is building
 *   · a cell renders an em-dash where a producer exists and is late
 *       → analytics stops writing and the console looks exactly the same
 *
 * Each is tested by FORCING the state and asserting the wrong glyph does not
 * appear — not by checking the right one does. Those are different tests, and
 * only the first one catches a function that returns the same thing always.
 */

const AUG = (d) => new Date(Date.UTC(2026, 7, d))     // August 2026
const FIRST_EVENT = AUG(12)                            // Wed 12 Aug — a real row exists

test('an ISO week starts on Monday, and Sunday belongs to the week that just ended', () => {
  assert.equal(isoWeekStart(AUG(12)).toISOString().slice(0, 10), '2026-08-10') // Wed → Mon
  assert.equal(isoWeekStart(AUG(10)).toISOString().slice(0, 10), '2026-08-10') // Mon → itself
  /* Sunday is the LAST day of its week, not the first. Getting this wrong
     shifts every reading by a day and nothing looks broken. */
  assert.equal(isoWeekStart(AUG(16)).toISOString().slice(0, 10), '2026-08-10')
  assert.equal(isoWeekStart(AUG(17)).toISOString().slice(0, 10), '2026-08-17')
})

test('the first reading date is derived from the first event, never typed', () => {
  /* One complete week: the week containing 12 Aug ends Sun 16, readable Mon 17. */
  assert.equal(firstReadingOn(FIRST_EVENT, 1).toISOString().slice(0, 10), '2026-08-17')
  /* Two complete weeks — 7-day return needs a week to return FROM. */
  assert.equal(firstReadingOn(FIRST_EVENT, 2).toISOString().slice(0, 10), '2026-08-24')
  assert.equal(firstReadingOn(FIRST_EVENT, 3).toISOString().slice(0, 10), '2026-08-31')
})

test('it prints as `first reading Mon 17 Aug`', () => {
  assert.equal(readingDateLabel(new Date(Date.UTC(2026, 7, 17))), 'Mon 17 Aug')
})

/* ─── THE THREE STATES, EACH FORCED ─────────────────────────────────────── */

test('NO PRODUCER renders an em-dash — and never a date', () => {
  const c = cellFor({
    producer: false, missing: 'Search Console has no history',
    earliestEvent: FIRST_EVENT, completeWeeks: 9, weeksNeeded: 1, value: 4, now: AUG(31),
  })
  assert.equal(c.kind, 'no-producer')
  assert.equal(render(c), '—')
  /* ⚠️ THE WRONG GLYPHS, ASSERTED ABSENT. Note this case has a first event, nine
     complete weeks AND a value — everything a number needs. If `producer` were
     checked after any of them, this would render 4. */
  assert.doesNotMatch(render(c), /first reading/)
  assert.doesNotMatch(render(c), /^\d/)
})

test('MEASURED ZERO renders 0 — and never an em-dash', () => {
  const c = cellFor({
    producer: true, earliestEvent: FIRST_EVENT,
    completeWeeks: 1, weeksNeeded: 1, value: 0, now: AUG(17),
  })
  assert.equal(render(c), '0')
  /* Thirteen rooms measured zero outbound clicks. An em-dash would hide it. */
  assert.notEqual(render(c), '—')
})

test('NO COMPLETE WEEK renders the date — and never 0, never an em-dash', () => {
  const c = cellFor({
    producer: true, earliestEvent: FIRST_EVENT,
    completeWeeks: 0, weeksNeeded: 1, value: null, now: AUG(13),
  })
  assert.equal(c.kind, 'pending')
  assert.equal(render(c), 'first reading Mon 17 Aug')
  assert.notEqual(render(c), '0')
  assert.notEqual(render(c), '—')
})

test('past its date and still not a number is a FAULT, not a state', () => {
  /* This is the whole reason the third state is a date. An em-dash here would
     be indistinguishable from "no producer", so analytics could stop writing
     for a month and the console would look unchanged. */
  const c = cellFor({
    producer: true, earliestEvent: FIRST_EVENT,
    completeWeeks: 0, weeksNeeded: 1, value: null, now: AUG(24),
  })
  assert.equal(c.kind, 'overdue')
  assert.ok(isFault(c))
  assert.match(render(c), /^OVERDUE since Mon 17 Aug/)
  assert.notEqual(render(c), '—')
})

test('a producer with no events at all is absent, not pending — there is no date to give', () => {
  const c = cellFor({
    producer: true, earliestEvent: null,
    completeWeeks: 0, weeksNeeded: 1, value: null, now: AUG(13),
  })
  assert.equal(c.kind, 'no-producer')
  assert.equal(render(c), '—')
})

/* ─── COMPOSITES ────────────────────────────────────────────────────────── */

const NUM = (v) => ({ kind: 'number', value: v })
const PENDING = (d) => ({ kind: 'pending', firstReading: d })

test('a composite with an ABSENT term is unknown, not a smaller number', () => {
  /* Loop gain with a share term nothing fires. Averaging over it would report
     a gain computed from three of four loops and call it the gain. */
  const c = composite(
    [NUM(2), NUM(4), { kind: 'no-producer', missing: 'nothing fires share_link_copy' }],
    (v) => v.reduce((a, b) => a + b, 0),
  )
  assert.equal(c.kind, 'no-producer')
  assert.equal(render(c), '—')
  assert.notEqual(render(c), '6')
})

test('a composite with a PENDING term takes the LATEST date, and never a number', () => {
  const c = composite(
    [NUM(2), PENDING(AUG(17)), PENDING(AUG(31))],
    (v) => v.reduce((a, b) => a + b, 0),
  )
  assert.equal(c.kind, 'pending')
  /* The latest, because the composite cannot be read until every input can. */
  assert.equal(render(c), 'first reading Mon 31 Aug')
})

test('a composite of real numbers is a number', () => {
  assert.equal(render(composite([NUM(2), NUM(4)], (v) => v[0] + v[1])), '6')
})

test('absent beats pending — the least knowable input wins', () => {
  const c = composite(
    [PENDING(AUG(17)), { kind: 'no-producer', missing: 'x' }],
    (v) => v[0],
  )
  assert.equal(c.kind, 'no-producer',
    'a pending term must not soften an absent one into a date the cell will never reach')
})
