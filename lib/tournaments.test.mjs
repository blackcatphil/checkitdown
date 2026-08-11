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
