import test from 'node:test'
import assert from 'node:assert/strict'

import { authorshipMove } from './description-authorship.ts'

/* ⚠️ THE ASYMMETRY IS THE WHOLE RULE. A test that only checked "partner may
   replace ours" would pass against a function that allowed everything. */
test('a partner review may replace Check It Down prose, and carries its authorship', () => {
  const m = authorshipMove('checkitdown', 'partner')
  assert.equal(m.allowed, true)
  assert.equal(m.carries, 'partner')
})

test('Check It Down prose may NEVER replace a partner review', () => {
  const m = authorshipMove('partner', 'checkitdown')
  assert.equal(m.allowed, false)
  assert.match(m.reason, /first-hand/)
  assert.match(m.reason, /§3\.1/)
})

test('same-tier replacement is allowed in both directions', () => {
  assert.equal(authorshipMove('partner', 'partner').allowed, true)
  assert.equal(authorshipMove('checkitdown', 'checkitdown').allowed, true)
})

test('an insert has nothing to displace and carries its own authorship', () => {
  assert.deepEqual(authorshipMove(null, 'partner'), { allowed: true, carries: 'partner' })
  assert.deepEqual(authorshipMove(null, 'checkitdown'), { allowed: true, carries: 'checkitdown' })
})

/* ⚠️ THE SILENT CASE. The three sync failures were caught only because those
   reviews quote dollar figures and `description_states_no_currency` refused the
   row. A partner review with no figures produced no error at all and left the
   row attributed to us. The rule must not depend on the prose. */
test('the rule does not depend on the text — a figureless partner review still carries authorship', () => {
  const m = authorshipMove('checkitdown', 'partner')
  assert.equal(m.carries, 'partner',
    'authorship must move on every partner replacement, not only the ones a CHECK happens to catch')
})
