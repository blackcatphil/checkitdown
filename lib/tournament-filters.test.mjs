import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EMPTY_FILTERS, ENTRY_BANDS, bandOf, describe as describeFilters, filterQuery,
  isFiltered, matches, parseFilters, toggle,
} from './tournament-filters.ts'

const KNOWN = { rooms: ['wynn-encore', 'caesars-palace'], games: ['nlh', 'plo', 'mixed', 'other'] }
const P = (q) => parseFilters(q, KNOWN)

test('a query with no filters constrains nothing', () => {
  const f = P({})
  assert.deepEqual(f, EMPTY_FILTERS)
  assert.equal(isFiltered(f), false)
  assert.equal(filterQuery(f), '')
})

test('every dimension takes a comma list, deduped', () => {
  const f = P({ game: 'nlh,mixed,nlh', day: '5,6' })
  assert.deepEqual(f.game, ['nlh', 'mixed'])
  assert.deepEqual(f.day, ['5', '6'])
  assert.ok(isFiltered(f))
})

/**
 * ⚠️ AN UNKNOWN VALUE IS DROPPED, NOT MATCHED. The alternative is an empty
 * table explained by a chip the reader cannot see — a hand-typed `?game=razz`
 * or a stale bookmark would look exactly like a room that stopped running
 * tournaments.
 */
test('unknown values are dropped so a bad query shows everything, not nothing', () => {
  assert.deepEqual(P({ game: 'razz' }).game, [])
  assert.deepEqual(P({ room: 'the-mirage' }).room, [])
  assert.deepEqual(P({ entry: 'cheap' }).entry, [])
  assert.deepEqual(P({ day: '9' }).day, [])
  assert.deepEqual(P({ day: '-1' }).day, [])
  assert.equal(isFiltered(P({ game: 'razz', day: '9' })), false)
})

test('a mix of known and unknown keeps the known half', () => {
  assert.deepEqual(P({ game: 'nlh,razz,mixed' }).game, ['nlh', 'mixed'])
})

test('the bands cover the line without a gap or an overlap', () => {
  /* Every dollar from 0 to 1000 lands in exactly one band — an off-by-a-cent
     at an edge would silently hide an event from every band filter. */
  for (let n = 0; n <= 1000; n += 0.5) {
    const hits = ENTRY_BANDS.filter((b) => n >= b.min && n <= b.max)
    assert.equal(hits.length, 1, `$${n} landed in ${hits.length} bands`)
  }
})

test('bandOf reads the figures a database driver returns', () => {
  assert.equal(bandOf(100), 'u150')
  assert.equal(bandOf('160.00'), '150-249')
  assert.equal(bandOf(240), '150-249')
  assert.equal(bandOf(400), '250-499')
  assert.equal(bandOf(600), '500up')
  assert.equal(bandOf(null), null)
  assert.equal(bandOf(''), null)
})

const ROW = {
  wynnNightly: { roomSlug: 'wynn-encore', game: 'nlh', entry: 160, days: [0, 1, 2, 3, 4, 5, 6] },
  wynnFriday: { roomSlug: 'wynn-encore', game: 'nlh', entry: 240, days: [5] },
  horse: { roomSlug: 'wynn-encore', game: 'mixed', entry: 400, days: [1] },
  caesars: { roomSlug: 'caesars-palace', game: 'nlh', entry: 100, days: [0, 1, 2, 3, 4, 5, 6] },
}

test('each dimension narrows on its own', () => {
  assert.equal(matches(ROW.horse, P({ game: 'mixed' })), true)
  assert.equal(matches(ROW.wynnFriday, P({ game: 'mixed' })), false)
  assert.equal(matches(ROW.caesars, P({ room: 'caesars-palace' })), true)
  assert.equal(matches(ROW.caesars, P({ room: 'wynn-encore' })), false)
  assert.equal(matches(ROW.caesars, P({ entry: 'u150' })), true)
  assert.equal(matches(ROW.horse, P({ entry: 'u150' })), false)
  assert.equal(matches(ROW.wynnFriday, P({ day: '5' })), true)
  assert.equal(matches(ROW.horse, P({ day: '5' })), false)
})

test('dimensions combine as AND, values within one as OR', () => {
  assert.equal(matches(ROW.horse, P({ game: 'mixed,plo' })), true)
  assert.equal(matches(ROW.horse, P({ game: 'mixed', entry: '250-499' })), true)
  assert.equal(matches(ROW.horse, P({ game: 'mixed', entry: 'u150' })), false)
})

test('a daily matches any day it runs on', () => {
  assert.equal(matches(ROW.wynnNightly, P({ day: '3' })), true)
  assert.equal(matches(ROW.wynnNightly, P({ day: '0' })), true)
  assert.equal(matches(ROW.wynnFriday, P({ day: '4,5' })), true)
})

/**
 * ⚠️ THE ASSERTION THAT KEEPS A FILTER FROM REPORTING OUR OWN GAPS AS FACTS.
 * A row with no `game` recorded is not "not a mixed game" — it is an event
 * nobody has classified, and hiding it behind a game filter would publish a hole
 * in our data as a statement about the room's schedule.
 */
test('a row that cannot answer a dimension is kept, not hidden', () => {
  const unclassified = { roomSlug: 'wynn-encore', game: null, entry: null, days: [] }
  assert.equal(matches(unclassified, P({ game: 'nlh' })), true)
  assert.equal(matches(unclassified, P({ entry: 'u150' })), true)
  assert.equal(matches(unclassified, P({ day: '5' })), true)
  /* But a dimension it CAN answer still constrains it. */
  assert.equal(matches({ ...unclassified, roomSlug: 'x' }, P({ room: 'wynn-encore' })), false)
})

test('toggle adds then removes, and the query round-trips', () => {
  let f = EMPTY_FILTERS
  f = toggle(f, 'game', 'nlh')
  assert.deepEqual(f.game, ['nlh'])
  f = toggle(f, 'game', 'mixed')
  assert.equal(filterQuery(f), '?game=nlh%2Cmixed')
  f = toggle(f, 'game', 'nlh')
  assert.deepEqual(f.game, ['mixed'])
  /* And what came out goes back in. */
  assert.deepEqual(P({ game: 'mixed' }), f)
})

test('the query keeps the sort alongside the filters', () => {
  const f = toggle(EMPTY_FILTERS, 'day', '5')
  assert.equal(filterQuery(f, { sort: 'fee' }), '?day=5&sort=fee')
  assert.equal(filterQuery(EMPTY_FILTERS, { sort: '' }), '')
})

test('the banner names what is filtered rather than counting it', () => {
  const name = (s) => (s === 'wynn-encore' ? 'Wynn/Encore' : 'Caesars Palace')
  const f = P({ room: 'wynn-encore', game: 'mixed', entry: '250-499', day: '1' })
  const s = describeFilters(f, name)
  assert.match(s, /Wynn\/Encore/)
  assert.match(s, /MIXED/)
  assert.match(s, /\$250–\$499/)
  assert.match(s, /MON/)
})

test('and two values in one dimension read as a choice, not a list of filters', () => {
  assert.equal(describeFilters(P({ day: '5,6' }), (s) => s), 'FRI or SAT')
})
