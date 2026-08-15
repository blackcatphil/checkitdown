import test from 'node:test'
import assert from 'node:assert/strict'

import { EVENT_NAMES } from './analytics-events.ts'
import { EVENT_FACTS, SPEC } from './growth.ts'

/**
 * THE SPEC TAB DESCRIBES THE PIPELINE, SO IT HAS TO BE UNABLE TO FALL BEHIND IT.
 *
 * `EVENT_FACTS` carries what each event fires on, what it carries and what the
 * roll-up does with it. Every word of it is a description of behaviour that
 * already exists — the doc comments in `analytics-events.ts` and the queries in
 * migration 021 — because the prototype's own ten-event table is invented
 * (readme.md:35) and none of it may cross.
 *
 * ⚠️ A HAND-MAINTAINED TABLE DESCRIBES LAST MONTH. Adding an event to the enum
 * and forgetting the row would leave the Spec tab quietly claiming the pipeline
 * has fewer inputs than it has, which is worse than an empty tab: it reads as
 * complete. These assertions are the reason the comment in `growth.ts` can
 * promise that, and they run offline in `test:unit`.
 */

test('the event parser is not vacuous', () => {
  assert.ok(EVENT_NAMES.length >= 7,
    `only ${EVENT_NAMES.length} events found — a scan that finds nothing agrees with everything`)
})

test('every event carries a "fires when", properties and a "feeds"', () => {
  const missing = EVENT_NAMES.filter((e) => !EVENT_FACTS[e])
  assert.deepEqual(missing, [],
    'these events are in the enum with no row on the Spec tab, so the page '
    + 'understates the pipeline while looking complete: ' + missing.join(', '))
  for (const e of EVENT_NAMES) {
    for (const k of ['when', 'props', 'feeds']) {
      assert.ok(EVENT_FACTS[e][k]?.trim(), `${e}.${k} is empty`)
    }
  }
})

test('no row describes an event that no longer exists', () => {
  /* The other direction, and it is not symmetry for its own sake: a retired
     event leaves a row claiming something still fires, which is the same class
     of lie pointing the other way. */
  const orphans = Object.keys(EVENT_FACTS)
    .filter((e) => !EVENT_NAMES.includes(e))
  assert.deepEqual(orphans, [],
    'these rows describe events that are no longer in the enum: ' + orphans.join(', '))
})

test('every decision event is a real event', () => {
  const unknown = SPEC.decisionEvents
    .filter((e) => !EVENT_NAMES.includes(e))
  assert.deepEqual(unknown, [],
    'decision_events names something the client never fires: ' + unknown.join(', '))
})
