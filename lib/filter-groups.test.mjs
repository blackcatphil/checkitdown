/* THE COLLAPSE RESOLVER. Asserted here rather than in the probe because one of
   its three rules — an active selection opening its own group — has no live
   path in the shipped product: checked filters are session state, not URL
   state, so a fresh load never arrives with something checked. A browser
   assertion could only have exercised the two reachable rules while reading as
   though it covered all three, which is the vacuous-pass shape this suite
   exists to refuse. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultOpen, resolveOpen, toggleOpen } from './filter-groups.ts'

test('the measured default: stakes sub-heads closed, everything else open', () => {
  assert.equal(defaultOpen('stakes:nlh'), false)
  assert.equal(defaultOpen('stakes:other'), false)
  assert.equal(defaultOpen('stakes'), true, 'the STAKES parent stays open — only its variants fold')
  assert.equal(defaultOpen('games'), true)
  assert.equal(defaultOpen('amen:food'), true)
})

test('an active selection OPENS its group regardless of the default', () => {
  assert.equal(resolveOpen('stakes:nlh', 0, {}), false)
  assert.equal(resolveOpen('stakes:nlh', 1, {}), true, 'a filtering group may not hide on arrival')
})

test('a user choice beats both the default and the active count', () => {
  /* THE TRAP, rule 1 at unit level: collapsing a filtering group is allowed,
     and nothing here touches the selection — this function cannot clear one. */
  assert.equal(resolveOpen('stakes:nlh', 3, { 'stakes:nlh': false }), false)
  assert.equal(resolveOpen('games', 0, { games: false }), false)
})

test('a deliberate false is not read as "no opinion"', () => {
  /* `id in userOpen`, not a truthiness check. Getting this wrong makes a
     collapsed GAMES group spring open again on the next render. */
  assert.equal(resolveOpen('games', 0, { games: false }), false)
  assert.equal(resolveOpen('games', 0, {}), true)
})

test('the toggle closes a group that was auto-opened by its own selection', () => {
  /* Regression: computing "current" from defaultOpen alone flipped false->true
     here, so the head rendered open, the click registered, and nothing moved. */
  const next = toggleOpen('stakes:nlh', 2, {})
  assert.equal(next['stakes:nlh'], false)
  assert.equal(resolveOpen('stakes:nlh', 2, next), false)
})

test('the toggle round-trips', () => {
  const a = toggleOpen('amen:food', 0, {})
  assert.equal(resolveOpen('amen:food', 0, a), false)
  const b = toggleOpen('amen:food', 0, a)
  assert.equal(resolveOpen('amen:food', 0, b), true)
})

test('toggling one group leaves every other alone', () => {
  const next = toggleOpen('stakes:plo', 0, { 'stakes:nlh': true, games: false })
  assert.equal(next['stakes:nlh'], true)
  assert.equal(next.games, false)
})
