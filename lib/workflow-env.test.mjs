import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * ⚠️ WHAT RUNS IN A WORKFLOW IS NOT WHAT RUNS ON A LAPTOP, AND ONLY ONE OF THEM
 * IS CHECKED BY EVERY OTHER TEST.
 *
 * On 2026-08-12 `DATABASE_URL` was split into a local name and a production one,
 * and every script was reclassified by reading what it does. `scripts/differ.mjs`
 * was classified `localTarget` — correct for how it is run by hand, and wrong for
 * the only way it runs unattended: `.github/workflows/sync.yml` invokes it daily
 * at 05:00 Pacific with `DIFFER_APPLY=1` and the production secret, and it is how
 * the partner's documents reach the app. A local-only guard would have refused
 * the cron outright, and the failure would have surfaced as "the sync did not
 * run" at an hour nobody is reading logs.
 *
 * Nothing in the suite could see that, because the mistake was not in a script —
 * it was in the relationship between a script and a workflow. So this test reads
 * the workflows as TEXT and asserts that relationship:
 *
 *   1. every script that writes to production is bound to PROD_DATABASE_URL,
 *      never to DATABASE_URL
 *   2. every step that runs one asserts its variable is present, at the step,
 *      so a missing secret fails on the cause rather than on a symptom
 *
 * It is offline, reads two files, and runs under `test:unit`.
 */
const WORKFLOWS = {
  'ci.yml': readFileSync('.github/workflows/ci.yml', 'utf8'),
  'sync.yml': readFileSync('.github/workflows/sync.yml', 'utf8'),
}

/** Steps split on the `- name:` / `- uses:` boundary at this repo's indent. */
function steps(text) {
  const out = []
  let cur = null
  for (const line of text.split('\n')) {
    if (/^ {6}- (name|uses|run):/.test(line)) {
      if (cur) out.push(cur)
      cur = { head: line.trim(), body: [line] }
    } else if (cur) {
      cur.body.push(line)
    }
  }
  if (cur) out.push(cur)
  return out.map((s) => ({ ...s, text: s.body.join('\n') }))
}

/* ⚠️ THE CONTROL, AND IT IS NOT OPTIONAL. Every assertion below is of the form
   "no step does X". A parser that found no steps at all would satisfy every one
   of them and report a clean run, which is precisely the vacuous-guard failure
   this repo keeps finding. So first: the parser must find the steps we know
   exist, by name. */
test('the workflow parser actually finds steps — without this every assertion below is vacuous', () => {
  const ci = steps(WORKFLOWS['ci.yml'])
  const sync = steps(WORKFLOWS['sync.yml'])
  assert.ok(ci.length > 15, `parsed only ${ci.length} steps from ci.yml`)
  assert.ok(sync.length > 3, `parsed only ${sync.length} steps from sync.yml`)
  assert.ok(sync.some((s) => /source sync/.test(s.head)), 'the "source sync" step was not found')
  assert.ok(ci.some((s) => /test:events/.test(s.head)), 'the test:events step was not found')
})

test('the production secret is bound to PROD_DATABASE_URL, never to DATABASE_URL', () => {
  for (const [file, text] of Object.entries(WORKFLOWS)) {
    for (const line of text.split('\n')) {
      if (/^\s*#/.test(line)) continue
      /* The failure this pins: `DATABASE_URL: ${{ secrets.CID_PROD_DATABASE_URL }}`.
         That line ran the daily sync until 2026-08-12 and is the exact shape of
         the ambiguity that put migration 017 on production. */
      assert.ok(
        !/^\s*DATABASE_URL:\s*\$\{\{\s*secrets\./.test(line),
        `${file}: a production secret is bound to DATABASE_URL, which means LOCAL.\n`
        + `  ${line.trim()}\n`
        + '  Bind it to PROD_DATABASE_URL — the secret name does not change.',
      )
    }
  }
})

/**
 * ⚠️ THE RULE IS ABOUT THE STEP THAT CONSUMES THE VARIABLE, NOT THE STEP THAT
 * RUNS THE SCRIPT — and my first version of this test got that wrong and failed.
 * It demanded the `test:events` step assert CID_EVENTS_DATABASE_URL; that
 * variable is consumed by the `next dev` step, which starts the server that
 * writes events, and ci.yml already asserts it there. Asserting it at the probe
 * would have been ritual: the probe never reads it.
 *
 * So the rule binds to where a secret ENTERS the workflow.
 */
test('every step that binds a production URL from a secret asserts it is present', () => {
  let checked = 0
  for (const [file, text] of Object.entries(WORKFLOWS)) {
    for (const step of steps(text)) {
      if (!/^\s*PROD_DATABASE_URL:\s*\$\{\{\s*secrets\./m.test(step.text)) continue
      checked++
      assert.match(
        step.text, /\[ -n "\$\{PROD_DATABASE_URL:-\}" \]/,
        `${file}: the step binding PROD_DATABASE_URL does not assert it is non-empty.\n`
        + '  A missing secret is an EMPTY STRING, not an error. The script would refuse\n'
        + '  with a message nobody is awake to read, and the run would look like "the\n'
        + '  sync did not happen" rather than "the sync was misconfigured".',
      )
    }
  }
  assert.ok(checked > 0, 'no step binds PROD_DATABASE_URL — this assertion tested nothing')
})

test('the events step keeps its own precedent — next dev asserts CID_EVENTS_DATABASE_URL', () => {
  /* The pattern this whole test file generalises: ci.yml already asserted the
     variable at the step that consumes it, and that is why a broken analytics
     config fails on the cause. Pinned so the precedent cannot quietly go. */
  const ci = WORKFLOWS['ci.yml']
  assert.match(ci, /\[ -n "\$\{CID_EVENTS_DATABASE_URL:-\}" \]/,
    'ci.yml no longer asserts CID_EVENTS_DATABASE_URL at the step that needs it')
})

test('the sync step still sets DIFFER_APPLY=1 — a silent dry run looks like a successful sync', () => {
  const sync = WORKFLOWS['sync.yml']
  assert.match(sync, /DIFFER_APPLY:\s*'1'/, 'sync.yml no longer sets DIFFER_APPLY=1')
  const step = steps(sync).find((s) => /source sync/.test(s.head))
  assert.ok(step, 'the source sync step is gone')
  assert.match(
    step.text, /DIFFER_APPLY:-\}" = "1"/,
    'the sync step does not assert DIFFER_APPLY=1 — without it the differ would '
    + 'dry-run and report a clean sync having written nothing',
  )
})
