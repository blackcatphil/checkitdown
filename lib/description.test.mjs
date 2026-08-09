import assert from 'node:assert/strict'
import test from 'node:test'
import { KNOWN_TOKENS, currencyFigures, resolveDescription } from './description.ts'

/* A room shaped like the page's own query. Values chosen so a mistake is
   visible: $1/2 and $5/10 are far enough apart that picking the wrong end of
   the sort cannot look plausible. */
const ROOM = {
  table_count: 24,
  cash_games: [
    { stakes_label: '$5/10', big_blind: 10, big_bet: null, min_buy_in: 1000,
      rake_type: 'percentage', rake_percent: 10, rake_cap: 8,
      verified_at: '2026-08-06', rake_verified_at: '2026-08-06' },
    { stakes_label: '$1/2', big_blind: 2, big_bet: null, min_buy_in: 100,
      rake_type: 'percentage', rake_percent: 10, rake_cap: 6,
      verified_at: '2026-08-06', rake_verified_at: null },
  ],
}

test('a figure reaches prose only by resolving from the room', () => {
  const r = resolveDescription('The main game is {stakes_lowest}.', ROOM)
  assert.equal(r.text, 'The main game is $1/2.')
  assert.equal(r.publish, true)
})

test('lowest and highest are the ends of the grid\'s own sort', () => {
  assert.equal(resolveDescription('{stakes_lowest}', ROOM).text, '$1/2')
  assert.equal(resolveDescription('{stakes_highest}', ROOM).text, '$5/10')
})

test('the unverified marker travels with the figure', () => {
  /* $1/2's rake is unverified, its stakes are not. The grid tildes exactly one
     of those, and so must a sentence stating both — prose that reads clean
     while the grid beside it reads unchecked is the Horseshoe contradiction. */
  const r = resolveDescription('{stakes_lowest} raked {rake_lowest}', ROOM)
  assert.equal(r.text, '$1/2 raked ~10% to $6')
})

test('a token with no fact behind it withholds the WHOLE description', () => {
  /* Recorded, not published — the room_formats precedent. A half-resolved
     paragraph is the worst option because it reads as finished. */
  const bare = { table_count: null, cash_games: [] }
  const r = resolveDescription('A {table_count}-table room spreading {stakes_lowest}.', bare)
  assert.equal(r.publish, false)
  assert.deepEqual(r.unresolved, ['table_count', 'stakes_lowest'])
})

test('an unknown token is unresolved, never printed to a reader', () => {
  const r = resolveDescription('spreads {stakes_lowset}', ROOM)
  assert.equal(r.publish, false)
  assert.deepEqual(r.unresolved, ['stakes_lowset'])
})

test('prose with no tokens publishes unchanged', () => {
  const r = resolveDescription('A long, quiet room off the casino floor.', ROOM)
  assert.equal(r.publish, true)
  assert.equal(r.text, 'A long, quiet room off the casino floor.')
})

test('ordinary braces are not mistaken for tokens', () => {
  const r = resolveDescription('The sign still reads {closed for renovation}.', ROOM)
  assert.equal(r.publish, true)
})

test('the stakes list keeps the grid order and reads as English', () => {
  assert.equal(resolveDescription('{stakes_list}', ROOM).text, '$1/2 and $5/10')
  const three = { ...ROOM, cash_games: [...ROOM.cash_games,
    { stakes_label: '$2/5', big_blind: 5, big_bet: null, min_buy_in: 500,
      rake_type: null, rake_percent: null, rake_cap: null,
      verified_at: '2026-08-06', rake_verified_at: null }] }
  assert.equal(resolveDescription('{stakes_list}', three).text, '$1/2, $2/5 and $5/10')
})

test('a rake the room has not stated withholds rather than inventing one', () => {
  const noRake = { table_count: 9, cash_games: [
    { stakes_label: '$1/3', big_blind: 3, big_bet: null, min_buy_in: null,
      rake_type: null, rake_percent: null, rake_cap: null,
      verified_at: null, rake_verified_at: null }] }
  assert.equal(resolveDescription('raked {rake_lowest}', noRake).publish, false)
})

test('every currency figure a resolver can emit is one the room holds', () => {
  /* THE PROBE'S RULE, asserted at unit level against every token this build
     knows. If a resolver ever synthesises a figure the room does not carry,
     this fails here rather than in a browser. */
  const roomFigures = new Set([
    ...ROOM.cash_games.flatMap((g) => [
      ...currencyFigures(g.stakes_label),
      ...(g.min_buy_in == null ? [] : currencyFigures(`$${g.min_buy_in}`)),
      ...(g.rake_cap == null ? [] : currencyFigures(`$${g.rake_cap}`)),
    ]),
  ])
  for (const tok of KNOWN_TOKENS) {
    const r = resolveDescription(`{${tok}}`, ROOM)
    if (!r.publish) continue
    for (const fig of currencyFigures(r.text)) {
      assert.ok(roomFigures.has(fig),
        `token {${tok}} emitted ${fig}, which is not in the room's own data`)
    }
  }
})

test('currencyFigures normalises the way the probe compares', () => {
  /* Canonical NUMBERS, not strings: "6.00" from a numeric column and "6" from
     the grid's formatter are the same figure and must compare equal. */
  assert.deepEqual(currencyFigures('$1/2 and $1,500 and $ 8'), ['1', '1500', '8'])
  assert.deepEqual(currencyFigures('$6.00 and $6 and $06'), ['6', '6', '6'])
  assert.deepEqual(currencyFigures('no figures here'), [])
})
