import assert from 'node:assert/strict'
import { test } from 'node:test'

import { costShape, parseTerms } from './tournament-terms.ts'

/**
 * THE FOUR NOTES ARE THE REAL ONES, copied from the database, not shapes
 * invented to suit the regexes. A parser tested against its own assumptions
 * passes forever — and these four sentences are the entire population it has to
 * read today, so getting them wrong is not a hypothetical.
 */
const WYNN = {
  daily10k: 'Re-entry allowed until the start of level 9 (approximately 4:30 p.m.).',
  friday: 'Re-entry is NOT allowed. Unlimited $200 rebuys at 15,000 chips or less, '
    + 'and one $100 add-on, until the start of level 9 (approximately 4:30 p.m.).',
  weekend: 'Re-entry and one $100 add-on until the start of level 11 (approximately 5:30 p.m.).',
  nightly: 'Re-entry and one $100 add-on until the start of level 9 (approximately 9:00 p.m.).',
}

/* Caesars is not in the database yet. Its sentence is here because the SCHEMA
   was shaped around it — "$50 add-on for 15,000 chips" is the case where the
   chip figure means the opposite of what it means at Wynn — and a parser that
   cannot read it would send the next room straight back to free text. */
const CAESARS = 'One $50 add-on for 15,000 chips, takeable only at the first break, '
  + 'with registration closes at the start of level seven.'

const ok = (note) => {
  const r = parseTerms(note)
  assert.ok(r.ok, `refused: ${r.ok === false ? r.why : ''}`)
  return r.terms
}

test('the Friday event: unlimited rebuys, a threshold, an add-on, and no re-entry', () => {
  const t = ok(WYNN.friday)
  assert.equal(t.rebuyAmount, 200)
  assert.equal(t.rebuyUnlimited, true)
  assert.equal(t.rebuyMax, null, 'unlimited must not also state a count')
  /* ⚠️ THE ASSERTION THIS WHOLE MIGRATION EXISTS FOR. 15,000 is the stack at or
     below which a rebuy may be taken. It is NOT chips received, and a schema
     that stored it as such would tell a reader they get 15,000 for $200. */
  assert.equal(t.rebuyMaxStack, 15000)
  assert.equal(t.rebuyChips, null, 'Wynn publishes no chip figure for a rebuy')
  assert.equal(t.addonAmount, 100)
  assert.equal(t.addonMax, 1)
  assert.equal(t.addonChips, null)
  assert.equal(t.reentryAllowed, false)
  assert.equal(t.closesAtLevel, 9)
  assert.equal(t.rebuyWindow, 'through_late_reg')
  assert.equal(t.addonWindow, 'through_late_reg')
})

test('the three other dailies: an add-on, no rebuy, re-entry allowed', () => {
  for (const [name, note, level] of [
    ['weekend', WYNN.weekend, 11], ['nightly', WYNN.nightly, 9],
  ]) {
    const t = ok(note)
    assert.equal(t.addonAmount, 100, name)
    assert.equal(t.addonMax, 1, name)
    assert.equal(t.rebuyAmount, null, `${name}: no rebuy is published`)
    assert.equal(t.rebuyUnlimited, false, name)
    assert.equal(t.reentryAllowed, true, name)
    assert.equal(t.closesAtLevel, level, name)
    assert.equal(t.addonWindow, 'through_late_reg', name)
  }
})

test('a note with no offers at all parses to no offers, not to a refusal', () => {
  const t = ok(WYNN.daily10k)
  assert.equal(t.rebuyAmount, null)
  assert.equal(t.addonAmount, null)
  assert.equal(t.reentryAllowed, true)
  assert.equal(t.closesAtLevel, 9)
  /* No offer, so no window — a window hanging off nothing is refused. */
  assert.equal(t.addonWindow, null)
  assert.equal(t.rebuyWindow, null)
})

test("Caesars' shape: the chip figure means chips RECEIVED, and the window is a break", () => {
  const t = ok(CAESARS)
  assert.equal(t.addonAmount, 50)
  assert.equal(t.addonChips, 15000, 'here 15,000 IS what you get')
  assert.equal(t.addonMax, 1)
  assert.equal(t.addonWindow, 'first_break')
  assert.equal(t.rebuyMaxStack, null, 'no rebuy, so no eligibility threshold')
  assert.equal(t.closesAtLevel, 7, 'stated in words, not digits')
})

/**
 * THE REFUSALS. Every one of these is a sentence a partial parser would answer
 * confidently and wrongly, which is the failure mode that matters: a cross-check
 * that silently reads half a note agrees with a declaration that could say
 * anything about the other half.
 */
test('an unrecognised money clause is refused, not partially read', () => {
  const r = parseTerms('One $100 add-on, and a $25 bounty on every knockout.')
  assert.equal(r.ok, false)
  assert.match(r.why, /unread text/)
  assert.match(r.why, /25|bounty/i)
})

test('a window with nothing to attach it to is refused', () => {
  const r = parseTerms('Late registration until the start of level 9.')
  assert.equal(r.ok, false)
})

test('an empty or missing note is refused rather than read as "no terms"', () => {
  assert.equal(parseTerms(null).ok, false)
  assert.equal(parseTerms('').ok, false)
  assert.equal(parseTerms('   ').ok, false)
})

test('a changed figure changes the parse — the cross-check can actually fail', () => {
  const a = ok(WYNN.friday)
  const b = ok(WYNN.friday.replace('$200 rebuys', '$300 rebuys'))
  assert.notEqual(b.rebuyAmount, a.rebuyAmount)
  const c = ok(WYNN.friday.replace('15,000 chips or less', '12,000 chips or less'))
  assert.equal(c.rebuyMaxStack, 12000)
})

/* ── The cost shape both surfaces read ────────────────────────────────── */

test('an event with no extras is bounded and lists nothing', () => {
  const c = costShape({ total_buy_in: 200 })
  assert.equal(c.entry, 200)
  assert.deepEqual(c.extras, [])
  assert.equal(c.bounded, true)
})

test('unlimited rebuys make the cost unbounded, and say so in words', () => {
  const c = costShape({ total_buy_in: 240, rebuy_amount: 200, rebuy_unlimited: true, addon_amount: 100, addon_max: 1 })
  assert.equal(c.bounded, false)
  assert.deepEqual(c.extras, [
    { label: 'REBUY', amount: 200, qualifier: 'unlimited' },
    { label: 'ADD-ON', amount: 100, qualifier: 'one' },
  ])
})

/**
 * AN UNSTATED COUNT IS NOT A CEILING. This is the case NULL-as-unlimited would
 * have erased: a room publishing a rebuy price and no count has not said
 * "unlimited", but it has not capped the cost either — so the surface must not
 * imply a total. Treating unknown as bounded is how a defensible-looking sum
 * gets printed about an event nobody bounded.
 */
test('a rebuy with no stated count does not bound the cost either', () => {
  const c = costShape({ total_buy_in: 200, rebuy_amount: 50 })
  assert.equal(c.bounded, false)
  assert.equal(c.extras[0].qualifier, null, 'and it does not claim "unlimited" on the room\'s behalf')
})

test('a counted rebuy and a counted add-on ARE bounded', () => {
  const c = costShape({ total_buy_in: 100, rebuy_amount: 50, rebuy_max: 2, addon_amount: 25, addon_max: 1 })
  assert.equal(c.bounded, true)
  assert.equal(c.extras[0].qualifier, 'up to 2')
})

test('costShape reads the strings a database driver hands back', () => {
  /* numeric(10,2) arrives as a string over supabase-js, and `'200.00' + 100`
     is '200.00100'. Coerced once, here, rather than at four call sites. */
  const c = costShape({ total_buy_in: '240.00', rebuy_amount: '200.00', rebuy_unlimited: true })
  assert.equal(c.entry, 240)
  assert.equal(c.extras[0].amount, 200)
})
