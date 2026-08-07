/**
 * The provenance sentence, tested away from the page.
 *
 * The regression these guard is not "wrong words" — it is a sentence that was
 * true when written and became false because the data moved underneath it. So
 * the assertions are about the RELATIONSHIP between the rows and the copy, and
 * the sharpest one is the last: no arrangement of verified facts may produce the
 * "nothing is confirmed" sentence.
 *
 *   node --test lib/provenance.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  claimsNothingVerified, PROVENANCE_COPY, provenanceState, unverifiedSources,
} from './provenance.ts'

const f = (kind, verified, sourceUrl = 'https://example.test/a') => ({ kind, verified, sourceUrl })

const SHEET = 'https://docs.google.com/spreadsheets/d/SHEET/edit'
const priv = (url) => url === SHEET
const host = (url) => { try { return new URL(url).hostname } catch { return null } }

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

test('nothing verified is NONE', () => {
  assert.equal(provenanceState([f('room', false), f('game', false)]), 'none')
})

test('everything verified is ALL, and ALL has no copy to render', () => {
  assert.equal(provenanceState([f('room', true), f('game', true)]), 'all')
  assert.equal(PROVENANCE_COPY.all, undefined, 'the all-verified state must have no sentence at all')
})

test('one verified fact among many moves the room off NONE', () => {
  assert.equal(
    provenanceState([f('room', false), f('game', false), f('rake', true)]),
    'some',
    'this is the Wynn case: four in-person rake receipts under a sentence denying them',
  )
})

test('one UNVERIFIED fact among many keeps the block rendering', () => {
  assert.equal(provenanceState([f('room', true), f('game', true), f('rake', false)]), 'some')
})

test('a page with no facts has no remainder to explain', () => {
  assert.equal(provenanceState([]), 'all')
})

// ---------------------------------------------------------------------------
// The claim that broke
// ---------------------------------------------------------------------------

test('THE COPY NEVER SAYS "nothing is confirmed" WHERE A VERIFIED FACT EXISTS', () => {
  /* Exhaustive over every mix of one verified fact with n unverified ones —
     the shape that shipped wrong, at every size it can take. */
  for (let n = 0; n < 12; n++) {
    const facts = [f('verified', true), ...Array.from({ length: n }, (_, i) => f(`u${i}`, false))]
    const state = provenanceState(facts)
    assert.equal(
      claimsNothingVerified(state), false,
      `${n} unverified facts alongside a verified one must not read as "nothing is confirmed"`,
    )
    assert.notEqual(PROVENANCE_COPY[state], PROVENANCE_COPY.none)
  }
})

test('the NONE sentence is reachable only with zero verified facts', () => {
  assert.equal(claimsNothingVerified(provenanceState([f('a', false)])), true)
  assert.equal(claimsNothingVerified(provenanceState([f('a', false), f('b', true)])), false)
})

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

test('sources come from the UNVERIFIED facts only', () => {
  const out = unverifiedSources([
    f('game', true, 'https://verified.test/x'),
    f('rake', false, 'https://unverified.test/y'),
  ], priv, host)
  assert.deepEqual(out.map((s) => s.host), ['unverified.test'],
    "a verified fact's receipt is the floor visit; republishing its URL offers weaker evidence as the reason")
})

test('two facts off one page are ONE source', () => {
  const out = unverifiedSources([
    f('g1', false, 'https://one.test/p'),
    f('g2', false, 'https://one.test/p'),
    f('g3', false, 'https://two.test/p'),
  ], priv, host)
  assert.deepEqual(out.map((s) => s.host), ['one.test', 'two.test'],
    'a repeated URL reads like corroboration that does not exist')
})

test('a private source is flagged so it can be named without a link', () => {
  const out = unverifiedSources([f('rake', false, SHEET)], priv, host)
  assert.equal(out.length, 1)
  assert.equal(out[0].isPrivate, true, 'the Drive sheet must never be rendered as an href')
})

test('a fact with no source contributes no citation rather than an empty one', () => {
  assert.deepEqual(unverifiedSources([f('x', false, null)], priv, host), [])
})

test('order is first-appearance, so the list is stable between renders', () => {
  const out = unverifiedSources([
    f('a', false, 'https://b.test/1'),
    f('b', false, 'https://a.test/1'),
  ], priv, host)
  assert.deepEqual(out.map((s) => s.host), ['b.test', 'a.test'])
})

test('an unparseable URL keeps its entry but has no host to show', () => {
  const out = unverifiedSources([f('x', false, 'not a url')], priv, host)
  assert.deepEqual(out, [{ url: 'not a url', host: null, isPrivate: false }])
})
