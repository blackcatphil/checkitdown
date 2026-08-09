/**
 * THE ROW-LEVEL TRAP, ASSERTED BY NAME.
 *
 * "$2/5 NLH" means ONE cash_games row that is both $2/5 and NLH. The failure
 * this guards against is a matcher that asks the two questions separately and
 * says yes to a room that spreads $2/5 in some OTHER variant.
 *
 * ARIA is the live counter-example: it spreads $1/2 PLO and no $1/2 NLH.
 * Bellagio is the positive control, and it is not optional — a negative
 * assertion on its own passes just as happily against a filter that matches
 * nothing at all, which is the failure mode one layer up.
 *
 *   node --test lib/stakes-filter.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyStakesFilter, comboCatalogue, comboKey, comboSort, roomCombos } from './stakes-filter.ts'

/* THE FIXTURES ARE THE REAL SEED, verified against the database before they
   were written down. The first draft invented them and both named assertions
   failed for the wrong reason: it gave ARIA no $2/5 NLH (it has one) and put
   $1/2 NLH in no room at all, so the filter correctly no-op'd and returned
   everything. A counter-example that fails because its fixture is fictional
   proves nothing about the code. */
const row = (game, stakes_label, big_blind = null, big_bet = null, spread_max = null) =>
  ({ game, stakes_label, big_blind, big_bet, spread_max })

const ARIA = {
  slug: 'aria',
  combos: roomCombos([
    row('nlh', '$1/3', 3), row('nlh', '$2/5', 5), row('nlh', '$5/10', 10),
    row('plo', '$1/2 PLO', 2), row('plo', '$5/5 PLO', 5),
  ]),
}
const BELLAGIO = {
  slug: 'bellagio',
  combos: roomCombos([
    row('nlh', '$1/3', 3), row('nlh', '$2/5', 5), row('nlh', '$5/10', 10), row('nlh', '$10/20', 20),
    row('plo', '$1/2 PLO', 2), row('plo', '$2/5 PLO', 5),
    row('lhe', '$4/8 limit', null, 8), row('lhe', '$20/40 limit', null, 40),
  ]),
}
/* The room that actually spreads $1/2 NLH — without it the key is unshippable
   and the filter no-ops, which would make the counter-example vacuous. */
const GOLDEN_NUGGET = {
  slug: 'golden-nugget',
  combos: roomCombos([
    row('nlh', '$1/2', 2),
    row('lhe', '$3/6 limit', null, 6), row('lhe', '$4/8 limit', null, 8),
  ]),
}
const ROOMS = [ARIA, BELLAGIO, GOLDEN_NUGGET]

test('THE COUNTER-EXAMPLE: ARIA spreads $1/2 PLO and must NOT match $1/2 NLH', () => {
  const key = comboKey('nlh', '$1/2')
  assert.ok(ARIA.combos.includes(comboKey('plo', '$1/2 PLO')), 'fixture: ARIA does spread $1/2 PLO')
  assert.ok(!ARIA.combos.includes(key), 'fixture: ARIA does not spread $1/2 NLH')
  const { matches } = applyStakesFilter(ROOMS, [key])
  assert.deepEqual(matches.map((r) => r.slug), ['golden-nugget'],
    'a room spreading $1/2 in PLO was matched for $1/2 NLH — the variant and the stakes came apart')
})

test('THE CONTROL: Bellagio spreads $2/5 PLO and DOES match it', () => {
  /* The positive half, and it is not decoration: the negative assertion above
     passes just as happily against a matcher that returns nothing at all. */
  const { matches } = applyStakesFilter(ROOMS, [comboKey('plo', '$2/5 PLO')])
  assert.deepEqual(matches.map((r) => r.slug), ['bellagio'])
})

test('...and $2/5 NLH matches both rooms that genuinely spread it', () => {
  const { matches } = applyStakesFilter(ROOMS, [comboKey('nlh', '$2/5')])
  assert.deepEqual(matches.map((r) => r.slug), ['aria', 'bellagio'])
})

test('checkboxes are ANDed, as everywhere else in the panel', () => {
  const both = applyStakesFilter(ROOMS, [comboKey('nlh', '$2/5'), comboKey('plo', '$2/5 PLO')])
  assert.deepEqual(both.matches.map((r) => r.slug), ['bellagio'],
    'AND means a room must spread BOTH')
  /* ARIA holds nlh $2/5 but not plo $2/5 PLO, so AND excludes it. OR would
     include it — that is the future ask, and this is why the current meaning
     is pinned rather than assumed. */
  assert.ok(ARIA.combos.includes(comboKey('nlh', '$2/5')))
})

test('no checkboxes means no filtering', () => {
  assert.equal(applyStakesFilter(ROOMS, []).matches.length, 3)
})

test('a key with no room behind it is DROPPED and named, never silently ignored', () => {
  const ghost = comboKey('nlh', '$500/1000')
  const r = applyStakesFilter(ROOMS, [ghost])
  assert.deepEqual(r.dropped, [ghost])
  assert.equal(r.matches.length, 3, 'a dropped key must not narrow anything')
})

test('SORT COMES OFF THE NUMBERS, never the label', () => {
  /* String order puts "$10/20" before "$2/5". The columns do not. */
  assert.equal(comboSort({ game: 'nlh', stakes_label: '$10/20', big_blind: 20, big_bet: null, spread_max: null }), 20)
  assert.equal(comboSort({ game: 'lhe', stakes_label: '$4/8 limit', big_blind: null, big_bet: 8, spread_max: null }), 8)
  /* The one spread-limit game in the city has neither blind nor bet columns. */
  assert.equal(comboSort({ game: 'stud', stakes_label: '$1-5 stud', big_blind: null, big_bet: null, spread_max: 5 }), 5)
})

test('the catalogue orders by variant, then numerically within it', () => {
  const meta = (g, l, n) => [comboKey(g, l), { variant: g, label: l, sort: n }]
  const rooms = [{
    combos: [comboKey('nlh', '$10/20'), comboKey('nlh', '$2/5'), comboKey('plo', '$1/2 PLO')],
    comboMeta: Object.fromEntries([meta('nlh', '$10/20', 20), meta('nlh', '$2/5', 5), meta('plo', '$1/2 PLO', 2)]),
  }]
  assert.deepEqual(comboCatalogue(rooms).map((c) => c.label), ['$2/5', '$10/20', '$1/2 PLO'])
})

test('an unlabelled row is not an option anyone can pick', () => {
  assert.deepEqual(roomCombos([{ game: 'nlh', stakes_label: null, big_blind: 2, big_bet: null, spread_max: null }]), [])
})
