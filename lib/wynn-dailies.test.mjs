import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { NOT_COMPARED, dailiesFromIngest, dailiesFromSeed, readValue, splitTop } from './wynn-dailies.ts'

/**
 * THE PAIR GATE. `supabase/seed.sql` and `scripts/tournaments/wynn.py` each
 * carry a hand transcription of the same four Wynn dailies, and Chat ruled that
 * both copies stay — the seed cannot fetch live PDFs and the ingest is the only
 * path that reaches production. See lib/wynn-dailies.ts for that reasoning.
 *
 * NO NETWORK, NO DATABASE. This reads two files off disk and compares them, so
 * it runs in `test:unit` — the cheapest gate, first in CI, and the one that
 * still works on the day Wynn's CDN is down.
 */

const ROOT = join(import.meta.dirname, '..')
const SEED = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8')
const INGEST = readFileSync(join(ROOT, 'scripts', 'tournaments', 'wynn.py'), 'utf8')

/* ── The lexer, before anything that depends on it ────────────────────── */

test('splitTop ignores commas inside strings, arrays and nested parens', () => {
  assert.deepEqual(splitTop("'a, b', 2, array[1,2,3], f(x, y)"),
    ["'a, b'", '2', 'array[1,2,3]', 'f(x, y)'])
  /* The doubled-quote escape SQL uses, which a naive split would break on. */
  assert.deepEqual(splitTop("'it''s, fine', 7"), ["'it''s, fine'", '7'])
})

test('readValue joins adjacent literals — the rebuy note is written as two', () => {
  assert.equal(readValue("'one, ' 'two'", 't'), 'one, two')
  assert.equal(readValue("'line one '\n     'line two'", 't'), 'line one line two')
  assert.equal(readValue("'it''s'", 't'), "it's")
})

test('readValue strips the decorations and normalises both array spellings', () => {
  assert.deepEqual(readValue('array[1,2,3,4]::smallint[]', 't'), [1, 2, 3, 4])
  assert.deepEqual(readValue('[6, 0]', 't'), [6, 0])
  assert.equal(readValue("'nlh'::game_kind", 't'), 'nlh')
  assert.equal(readValue("time '12:00'", 't'), '12:00')
  assert.equal(readValue("date '2026-06-19'", 't'), '2026-06-19')
  assert.equal(readValue('true', 't'), true)
  assert.equal(readValue('False', 't'), false)
  assert.equal(readValue('162.00', 't'), 162)
})

test('readValue refuses what it cannot read rather than returning something', () => {
  assert.throws(() => readValue('coalesce(a, b)', 'here'), /here: cannot read value/)
})

/* ── Both sides parse at all ──────────────────────────────────────────── */

const seed = dailiesFromSeed(SEED)
const ingest = dailiesFromIngest(INGEST)

/**
 * ASSERTED BEFORE ANY COMPARISON. Two empty lists are equal, and so are two
 * lists of objects with no keys — a parser that quietly stopped matching would
 * report perfect agreement between two things it never read. This is the
 * assertion that stands between this file and being decorative.
 */
test('both copies parse to four rows with eighteen compared columns each', () => {
  assert.equal(seed.rows.length, 4, `seed parsed ${seed.rows.length} dailies`)
  assert.equal(ingest.rows.length, 4, `ingest parsed ${ingest.rows.length} dailies`)
  for (const [where, rows] of [['seed', seed.rows], ['ingest', ingest.rows]]) {
    for (const r of rows) {
      assert.equal(Object.keys(r).length, 18,
        `${where}: ${r.slug ?? '(unnamed)'} carries ${Object.keys(r).length} compared fields, not 18`)
      for (const [k, v] of Object.entries(r)) {
        assert.ok(v !== undefined && v !== null && v !== '', `${where}: ${r.slug}.${k} is empty`)
      }
    }
  }
})

test('the two column lists are the same columns in the same order', () => {
  assert.deepEqual(ingest.columns, seed.columns)
  /* 21 columns: 18 compared, room_id, and the two fetch stamps. */
  assert.equal(seed.columns.length, 21)
  for (const c of NOT_COMPARED) assert.ok(seed.columns.includes(c), `${c} is not in the insert at all`)
})

/* ── The comparison ───────────────────────────────────────────────────── */

/**
 * COLUMN BY COLUMN, NAMED. A single `deepEqual` on the two arrays would be one
 * line and would report "expected X to equal Y" over two 700-character objects,
 * which is a diff nobody reads at five in the morning. Per-column assertions
 * say which daily and which field.
 */
test('every daily agrees on every compared column', () => {
  const bySlug = (rows) => Object.fromEntries(rows.map((r) => [r.slug, r]))
  const s = bySlug(seed.rows)
  const i = bySlug(ingest.rows)
  assert.deepEqual(Object.keys(s).sort(), Object.keys(i).sort(), 'the two copies name different dailies')

  for (const slug of Object.keys(s).sort()) {
    for (const field of Object.keys(s[slug]).sort()) {
      assert.deepEqual(i[slug][field], s[slug][field],
        `${slug}.${field}: ingest ${JSON.stringify(i[slug][field])} vs seed ${JSON.stringify(s[slug][field])}`)
    }
  }
})

/**
 * THE SPLIT MUST REPRODUCE THE POSTER'S HEADLINE NUMBER, on both copies.
 *
 * `total_buy_in` is a GENERATED column, so it appears in neither file and a
 * column-by-column diff cannot see it. Two transcriptions can agree with each
 * other and both be wrong about the same poster — which is exactly what
 * happens when the second copy is made by reading the first. The headline
 * figures are in the slugs and the names, so they are checked against the
 * parts.
 */
test('entry + fee + staff reproduces the buy-in each daily is named for', () => {
  const headline = { 'wynn-daily-200-nlh-10k': 200, 'wynn-daily-240-nlh-rebuy-40k': 240,
    'wynn-daily-200-nlh-25k': 200, 'wynn-nightly-160-nlh-10k': 160 }
  for (const rows of [seed.rows, ingest.rows]) {
    for (const r of rows) {
      assert.ok(r.slug in headline, `unexpected daily ${r.slug} — add its headline buy-in here`)
      assert.equal(r.entry + r.fee + r.staff, headline[r.slug],
        `${r.slug}: the parts total ${r.entry + r.fee + r.staff}, not the ${headline[r.slug]} it is named for`)
    }
  }
})

test('the days of the week are covered exactly once across the midday dailies', () => {
  /* The three noon events partition the week; the nightly one runs every day.
     A transcription slip that moved Friday would otherwise agree with itself. */
  for (const rows of [seed.rows, ingest.rows]) {
    const midday = rows.filter((r) => r.startTime.startsWith('12:'))
    const days = midday.flatMap((r) => r.days).sort((a, b) => a - b)
    assert.deepEqual(days, [0, 1, 2, 3, 4, 5, 6], `midday dailies cover ${JSON.stringify(days)}`)
    const nightly = rows.filter((r) => !r.startTime.startsWith('12:'))
    assert.equal(nightly.length, 1)
    assert.deepEqual([...nightly[0].days].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6])
  }
})

/**
 * THE NEGATIVE CONTROL. Everything above passes if the two parsers happen to
 * read the same thing from the same place — so one copy is mutated in memory
 * and the comparison must go red. Without this, a bug that made both parsers
 * return the seed's rows would be invisible and every assertion here would be
 * ceremony.
 */
test('a one-character difference in either copy is caught', () => {
  const moved = INGEST.replace("guarantee=25000.00", "guarantee=25500.00")
  assert.notEqual(moved, INGEST, 'the fixture edit did not apply — the anchor text has moved')
  const drifted = dailiesFromIngest(moved)
  const seedWeekend = seed.rows.find((r) => r.slug === 'wynn-daily-200-nlh-25k')
  const driftedWeekend = drifted.rows.find((r) => r.slug === 'wynn-daily-200-nlh-25k')
  assert.notDeepEqual(driftedWeekend.guarantee, seedWeekend.guarantee,
    'a changed guarantee in the ingest was not visible in the parsed rows')
})

test('and a changed NOTE is caught — the longest field, and the one a diff skims', () => {
  const moved = SEED.replace('approximately 5:30 p.m.', 'approximately 5:45 p.m.')
  assert.notEqual(moved, SEED, 'the fixture edit did not apply — the anchor text has moved')
  const drifted = dailiesFromSeed(moved)
  const a = drifted.rows.find((r) => r.slug === 'wynn-daily-200-nlh-25k').reentryNote
  const b = ingest.rows.find((r) => r.slug === 'wynn-daily-200-nlh-25k').reentryNote
  assert.notEqual(a, b, 'a changed re-entry note did not survive parsing as a difference')
})
