import assert from 'node:assert/strict'
import test from 'node:test'
import { dayLabel, timeLabel } from './tournaments.ts'

test('the four Wynn dailies read the way the poster writes them', () => {
  /* Taken from the live poster, not invented: Monday–Thursday, Friday,
     Saturday & Sunday, and nightly. */
  assert.equal(dayLabel([1, 2, 3, 4]), 'MON–THU')
  assert.equal(dayLabel([5]), 'FRI')
  assert.equal(dayLabel([6, 0]), 'SAT & SUN')
  assert.equal(dayLabel([0, 1, 2, 3, 4, 5, 6]), 'DAILY')
})

test('the weekend reads SAT & SUN, never SUN, SAT', () => {
  /* 0=Sun sorts first numerically, which would print "SUN & SAT" — not a
     thing any poker room writes. The week starts Monday here for that reason,
     and the input order must not matter. */
  assert.equal(dayLabel([0, 6]), 'SAT & SUN')
  assert.equal(dayLabel([6, 0]), 'SAT & SUN')
})

test('a run of three or more collapses; two are listed', () => {
  assert.equal(dayLabel([1, 2, 3]), 'MON–WED')
  assert.equal(dayLabel([1, 2]), 'MON & TUE')
})

test('non-contiguous days are listed, not falsely ranged', () => {
  /* MON–FRI would claim three tournaments that do not run. */
  assert.equal(dayLabel([1, 5]), 'MON, FRI')
  assert.equal(dayLabel([1, 3, 5]), 'MON, WED, FRI')
})

test('a one-off says so rather than claiming a weekly', () => {
  assert.equal(dayLabel(null), 'ONE-OFF')
  assert.equal(dayLabel([]), 'ONE-OFF')
})

test('times read the way the poster prints them', () => {
  assert.equal(timeLabel('12:00:00'), '12 P.M.')
  assert.equal(timeLabel('18:00:00'), '6 P.M.')
  assert.equal(timeLabel('11:00:00'), '11 A.M.')
  /* Midnight is 12 A.M., not 0 A.M. — the modulo trap. */
  assert.equal(timeLabel('00:00:00'), '12 A.M.')
})

import { vegasParts } from './tournaments.ts'

test('an evening event belongs to the day it runs, not the UTC day', () => {
  /* THE BUG THIS EXISTS FOR. 6 P.M. Pacific on 17 August is 01:00Z on the 18th.
     Reading the date off the ISO string filed every evening event under the
     following day and grew a phantom group past the end of the series. */
  const p = vegasParts('2026-08-18T01:00:00.000Z')
  assert.equal(p.date, '2026-08-17')
  assert.equal(p.time, '18:00:00')
  assert.equal(timeLabel(p.time), '6 P.M.')
})

test('a midday event is unaffected, which is why this hid', () => {
  /* 12 P.M. Pacific is 19:00Z the SAME day, so every daytime event looked
     right — and 37 of the 61 events are daytime. */
  const p = vegasParts('2026-08-17T19:00:00.000Z')
  assert.equal(p.date, '2026-08-17')
  assert.equal(timeLabel(p.time), '12 P.M.')
})

test('the last night of the series does not spill into the next month', () => {
  const p = vegasParts('2026-09-08T01:00:00.000Z')
  assert.equal(p.date, '2026-09-07')
})
