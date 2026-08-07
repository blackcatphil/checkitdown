/**
 * THE THIRD STATE IS THE PRODUCT DECISION, so it is tested away from the map.
 *
 * Every assertion here is about the difference between "asked and told no" and
 * "never asked". A filter that cannot tell those apart is the failure that kept
 * the amenity groups switched off for weeks, and it would pass any test written
 * in terms of match-vs-no-match.
 *
 *   node --test lib/amenity-filter.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AMENITY_SHIP_FLOOR, amenityGroups, amenityState, answeredFor,
  combineStates, shippableAmenities, summaryLine, tally,
} from './amenity-filter.ts'

const DEFS = [
  { slug: 'tableside', label: 'Tableside food', grp: 'food_drink', sort: 0 },
  { slug: 'kitchen24', label: '24-hour kitchen', grp: 'food_drink', sort: 1 },
  { slug: 'freeself', label: 'Free self-park', grp: 'parking', sort: 0 },
  { slug: 'validated', label: 'Validated parking', grp: 'parking', sort: 1 },
  { slug: 'usb', label: 'USB at seat', grp: 'comfort', sort: 0 },
]

/** n rooms answering `answers`, then the rest with nothing recorded. */
const roster = (specs) => specs.map((amenities) => ({ amenities }))

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

test('every checked slug a confirmed yes is a MATCH', () => {
  assert.equal(amenityState({ freeself: true, tableside: true }, ['freeself', 'tableside']), 'match')
})

test('a confirmed NO is ABSENT — the room was asked and does not have it', () => {
  assert.equal(amenityState({ freeself: false }, ['freeself']), 'absent')
})

test('NO ROW AT ALL is UNKNOWN, not absent — this is the whole reason for the state', () => {
  assert.equal(amenityState({}, ['freeself']), 'unknown')
})

test('a confirmed no OUTRANKS an unanswered slug', () => {
  assert.equal(
    amenityState({ freeself: false }, ['freeself', 'tableside']),
    'absent',
    'the room lacks something asked for; an unrelated gap does not soften that',
  )
})

test('one unanswered slug makes the room UNKNOWN even when every other is yes', () => {
  assert.equal(
    amenityState({ freeself: true }, ['freeself', 'tableside']),
    'unknown',
    'three of four confirmed is not a match — that rounding is how a filtered list gains rooms that fail the filter',
  )
})

test('no checked slugs means every room matches — an empty filter filters nothing', () => {
  assert.equal(amenityState({}, []), 'match')
})

test('an explicit false is never read as merely missing', () => {
  // The bug this guards: `if (!answers[slug])` treats false and undefined alike.
  assert.notEqual(amenityState({ freeself: false }, ['freeself']), amenityState({}, ['freeself']))
})

// ---------------------------------------------------------------------------
// Folding the game filter in
// ---------------------------------------------------------------------------

test('combine keeps the same precedence: absent beats unknown beats match', () => {
  assert.equal(combineStates('match', 'unknown', 'absent'), 'absent')
  assert.equal(combineStates('match', 'unknown'), 'unknown')
  assert.equal(combineStates('match', 'match'), 'match')
})

test('a room that fails the GAME filter is absent however complete its amenities', () => {
  assert.equal(combineStates('absent', amenityState({ freeself: true }, ['freeself'])), 'absent')
})

test('a game match with an unanswered amenity is unknown, not a match', () => {
  assert.equal(combineStates('match', amenityState({}, ['freeself'])), 'unknown')
})

// ---------------------------------------------------------------------------
// What ships
// ---------------------------------------------------------------------------

test('a slug ships at the floor and not one room below it', () => {
  const at = roster(Array.from({ length: AMENITY_SHIP_FLOOR }, () => ({ freeself: true })))
  const below = roster(Array.from({ length: AMENITY_SHIP_FLOOR - 1 }, () => ({ freeself: true })))
  assert.equal(shippableAmenities(at, DEFS).some((d) => d.slug === 'freeself'), true)
  assert.equal(shippableAmenities(below, DEFS).some((d) => d.slug === 'freeself'), false)
})

test('a confirmed NO counts as an answer — coverage is about having asked', () => {
  const allNo = roster(Array.from({ length: AMENITY_SHIP_FLOOR }, () => ({ freeself: false })))
  assert.equal(
    shippableAmenities(allNo, DEFS).some((d) => d.slug === 'freeself'), true,
    'thirteen rooms that said no is thirteen rooms someone asked',
  )
})

test('answeredFor counts answers, not yeses', () => {
  const rooms = roster([{ freeself: true }, { freeself: false }, {}])
  assert.equal(answeredFor(rooms, 'freeself'), 2)
})

test('a group header appears only when it has a shipped slug', () => {
  const rooms = roster(Array.from({ length: AMENITY_SHIP_FLOOR }, () => ({ freeself: true })))
  const groups = amenityGroups(rooms, DEFS)
  assert.deepEqual(groups.map((g) => g.label), ['PARKING'])
  assert.deepEqual(groups[0].items.map((d) => d.slug), ['freeself'],
    'validated has no answers and must not appear under a header its data cannot fill')
})

test('groups keep a fixed order rather than a coverage-dependent one', () => {
  const rooms = roster(Array.from({ length: AMENITY_SHIP_FLOOR }, () => ({ freeself: true, tableside: true })))
  assert.deepEqual(amenityGroups(rooms, DEFS).map((g) => g.label), ['FOOD & DRINK', 'PARKING'])
})

test('nothing ships from an empty roster', () => {
  assert.deepEqual(amenityGroups([], DEFS), [])
})

// ---------------------------------------------------------------------------
// Saying it out loud
// ---------------------------------------------------------------------------

test('the panel line reports all three counts', () => {
  assert.equal(summaryLine({ match: 7, absent: 6, unknown: 4 }), "7 match · 6 don't · 4 not yet checked")
})

test('the unknown clause is dropped at zero, never folded into the others', () => {
  assert.equal(summaryLine({ match: 7, absent: 10, unknown: 0 }), "7 match · 10 don't")
})

test('unknowns are never counted as matches', () => {
  const t = tally(['match', 'match', 'unknown', 'absent'])
  assert.deepEqual(t, { match: 2, absent: 1, unknown: 1 })
  assert.equal(t.match + t.absent + t.unknown, 4, 'every room lands in exactly one bucket')
})

// ---------------------------------------------------------------------------
// The real roster, as seeded
// ---------------------------------------------------------------------------

test('the seeded coverage ships exactly freeself and tableside', () => {
  /* freeself is answered for 13 of 17, tableside for 15 — measured against the
     database on 2026-08-07. The four freeself gaps are wynn-encore, venetian,
     skyline and boulder-station; tableside's two are skyline and
     boulder-station. */
  const rooms = roster([
    ...Array.from({ length: 13 }, () => ({ freeself: true, tableside: true })),
    { tableside: true }, { tableside: true },   // answered tableside, not freeself
    {}, {},                                     // skyline, boulder-station
  ])
  assert.equal(rooms.length, 17)
  assert.equal(answeredFor(rooms, 'freeself'), 13)
  assert.equal(answeredFor(rooms, 'tableside'), 15)
  assert.deepEqual(
    shippableAmenities(rooms, DEFS).map((d) => d.slug).sort(),
    ['freeself', 'tableside'],
  )
})
