import assert from 'node:assert/strict'
import test from 'node:test'
import { parseParking, parseRake, parseVendor, parseYesNo, phoneDigits, readFloorSheet, resolveRoom } from './floor-sheet.ts'

/* The real roster, in the shape resolveRoom sees it. */
const ROOMS = [
  { slug: 'aria', name: 'ARIA', property: 'ARIA Resort & Casino' },
  { slug: 'bellagio', name: 'Bellagio', property: 'Bellagio' },
  { slug: 'boulder-station', name: 'Boulder Station', property: 'Boulder Station Hotel & Casino' },
  { slug: 'caesars-palace', name: 'Caesars Palace', property: 'Caesars Palace' },
  { slug: 'golden-nugget', name: 'Golden Nugget', property: 'Golden Nugget Las Vegas' },
  { slug: 'green-valley-ranch', name: 'Green Valley Ranch', property: 'Green Valley Ranch Resort Spa Casino' },
  { slug: 'horseshoe', name: 'Horseshoe', property: 'Horseshoe Las Vegas' },
  { slug: 'mandalay-bay', name: 'Mandalay Bay', property: 'Mandalay Bay Resort & Casino' },
  { slug: 'mgm-grand', name: 'MGM Grand', property: 'MGM Grand Las Vegas' },
  { slug: 'orleans', name: 'The Orleans', property: 'The Orleans Hotel & Casino' },
  { slug: 'red-rock', name: 'Red Rock Resort', property: 'Red Rock Casino Resort Spa' },
  { slug: 'santa-fe-station', name: 'Santa Fe Station', property: 'Santa Fe Station Hotel & Casino' },
  { slug: 'skyline', name: 'Skyline', property: 'Skyline Hotel & Casino' },
  { slug: 'south-point', name: 'South Point', property: 'South Point Hotel Casino Spa' },
  { slug: 'venetian', name: 'Venetian', property: 'The Venetian Resort Las Vegas' },
  { slug: 'westgate', name: 'Westgate', property: 'Westgate Las Vegas Resort & Casino' },
  { slug: 'wynn-encore', name: 'Wynn/Encore', property: 'Encore at Wynn Las Vegas' },
]

test('every name the live sheet actually uses resolves, and to the right room', () => {
  /* Taken from the published sheet on 2026-08-09, not imagined. */
  const LIVE = [
    ['Wynn', 'wynn-encore'], ['Venetian', 'venetian'], ['Caesars Palace', 'caesars-palace'],
    ['Bellagio', 'bellagio'], ['Orleans', 'orleans'], ['MGM Grand', 'mgm-grand'],
    ['South Point', 'south-point'], ['Santa Fe Station', 'santa-fe-station'],
    ['Green Valley Ranch', 'green-valley-ranch'], ['Red Rock', 'red-rock'],
    ['Golden Nugget', 'golden-nugget'], ['Aria', 'aria'], ['Horseshoe', 'horseshoe'],
    ['Mandalay Bay', 'mandalay-bay'], ['Westgate', 'westgate'],
  ]
  for (const [sheet, slug] of LIVE) {
    const r = resolveRoom(sheet, ROOMS)
    assert.ok(r.ok, `${sheet} did not resolve: ${r.ok ? '' : r.why}`)
    assert.equal(r.slug, slug, `${sheet} resolved to ${r.slug}`)
  }
})

test('an unknown room is refused, never nearest-matched', () => {
  /* The banned behaviour, by name: top-hit-wins once sent "Venetian" to the
     Sphere. A miss must be a miss. */
  const r = resolveRoom('Circa', ROOMS)
  assert.equal(r.ok, false)
  assert.match(r.why, /matches no room/)
})

test('an AMBIGUOUS name resolves to nothing rather than to one of them', () => {
  const twoStations = [
    { slug: 'boulder-station', name: 'Boulder Station', property: null },
    { slug: 'santa-fe-station', name: 'Station', property: null },
  ]
  const r = resolveRoom('Station', twoStations)
  /* 'station' matches santa-fe-station exactly and boulder-station not at all,
     so this one IS decidable — the guard is asserted below with a real tie. */
  assert.equal(r.ok, true)
  const tie = resolveRoom('S', [
    { slug: 'south-point', name: 'South Point', property: null },
    { slug: 'skyline', name: 'Skyline', property: null },
  ])
  assert.equal(tie.ok, false)
  assert.match(tie.why, /ambiguous/)
})

test('rake notation, including the spaced form Santa Fe uses', () => {
  assert.deepEqual(parseRake('5+3'), { cap: 5, drop: 3 })
  assert.deepEqual(parseRake('5 + 3'), { cap: 5, drop: 3 })
  assert.deepEqual(parseRake('6+0'), { cap: 6, drop: 0 })
  assert.equal(parseRake('rare'), null)
  assert.equal(parseRake('5'), null, 'a bare number does not state a drop')
})

test('a parking PRICE is a confirmed absence, not a missing answer', () => {
  assert.equal(parseParking('Free'), true)
  assert.equal(parseParking('$25'), false)
  assert.equal(parseParking('sometimes'), null)
})

test('"no but close" is NOT coerced to a boolean', () => {
  /* South Point's real value. It means no tableside service but food nearby —
     an observation. Rounding it to false records a confident answer the sheet
     did not give. */
  assert.equal(parseYesNo('yes'), true)
  assert.equal(parseYesNo('no'), false)
  assert.equal(parseYesNo('no but close'), null)
})

test('vendors map to the enum the database spells', () => {
  assert.equal(parseVendor('Atlas'), 'pokeratlas')
  assert.equal(parseVendor('Bravo'), 'bravo')
  assert.equal(parseVendor('Jackpot'), null)
})

test('phones compare by digits, so formatting is not a change', () => {
  assert.equal(phoneDigits('(702) 770-7654'), '7027707654')
  assert.equal(phoneDigits('702-770-7654'), '7027707654')
})

test('the live header shape is read; a renamed column refuses the whole sheet', () => {
  const good = [
    ['Room', 'Rake', 'Alt Games', 'Tableside Food', 'Parking', 'Atlas or Bravo', 'Phone'],
    ['', '', '', '', '', '', ''],
    ['Wynn', '5+0', 'plo', 'yes', 'Free', 'Atlas', '(702) 770-7654'],
  ]
  const r = readFloorSheet(good, ROOMS)
  assert.equal(r.facts.filter((f) => f.kind === 'rake').length, 1)
  assert.equal(r.facts.filter((f) => f.kind === 'phone').length, 1)
  assert.equal(r.facts.filter((f) => f.kind === 'amenity').length, 2)
  assert.equal(r.facts.filter((f) => f.kind === 'vendor').length, 1)
  /* Alt Games is reported, never parsed. */
  assert.ok(r.unparsed.some((u) => u.column === 'Alt Games'))

  const renamed = [['Room', 'Rake %', 'Alt Games', 'Tableside Food', 'Parking', 'Atlas or Bravo', 'Phone']]
  const bad = readFloorSheet(renamed, ROOMS)
  assert.equal(bad.facts.length, 0, 'a renamed column stops the sheet rather than shifting values')
  assert.match(bad.unparsed[0].why, /no longer has these columns/)
})

test('the blank spacer row under the header is not an error', () => {
  const r = readFloorSheet([
    ['Room', 'Rake', 'Alt Games', 'Tableside Food', 'Parking', 'Atlas or Bravo', 'Phone'],
    ['', '', '', '', '', '', ''],
  ], ROOMS)
  assert.equal(r.unparsed.length, 0)
})

import { firstSeenDate, storageBlockers } from './reviews-doc.ts'

test('first-seen: a review we have never held is dated today', () => {
  const d = firstSeenDate(null, 'the prose', '2026-08-09')
  assert.deepEqual(d, { writtenAt: '2026-08-09', state: 'new' })
})

test('first-seen DOES NOT MOVE on an unchanged re-read — the whole point', () => {
  /* This job runs every morning. If re-reading restamped the date, every review
     would permanently read "written today" and the signal would quietly stop
     meaning anything while still being displayed. */
  const d = firstSeenDate({ body: 'the prose', writtenAt: '2026-07-01' }, 'the prose', '2026-08-09')
  assert.deepEqual(d, { writtenAt: '2026-07-01', state: 'unchanged' })
})

test('first-seen MOVES when the author rewrites the text', () => {
  const d = firstSeenDate({ body: 'the prose', writtenAt: '2026-07-01' }, 'the prose, edited', '2026-08-09')
  assert.deepEqual(d, { writtenAt: '2026-08-09', state: 'rewritten' })
})

test('a partner review keeps its figures; ours may not type them', () => {
  /* Migration 009: the constraint binds checkitdown prose only. */
  const review = { slug: 'wynn-encore', heading: 'The Wynn', body: 'PLO runs with a $5 limp.', words: 6, figures: ['$5'] }
  assert.deepEqual(storageBlockers(review, 'partner'), [])
  assert.equal(storageBlockers(review, 'checkitdown').length, 1)
  assert.match(storageBlockers(review, 'checkitdown')[0], /interpolate tokens/)
})
