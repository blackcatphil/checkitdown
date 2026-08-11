import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { parseTerms } from './tournament-terms.ts'
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
test('both copies parse to four rows with twenty-eight compared columns each', () => {
  assert.equal(seed.rows.length, 4, `seed parsed ${seed.rows.length} dailies`)
  assert.equal(ingest.rows.length, 4, `ingest parsed ${ingest.rows.length} dailies`)
  for (const [where, rows] of [['seed', seed.rows], ['ingest', ingest.rows]]) {
    for (const r of rows) {
      /* 18 before migration 014, 28 after. Pinned rather than derived: the
         whole job of this assertion is to notice a column quietly dropping out
         of the comparison, and a count computed from the parse would drop with
         it. */
      assert.equal(Object.keys(r).length, 28,
        `${where}: ${r.slug ?? '(unnamed)'} carries ${Object.keys(r).length} compared fields, not 28`)
      /* ⚠️ NULL IS A VALUE HERE, not a gap. `rebuy_chips` is null on all four
         because Wynn never publishes what $200 buys, and `rebuy_max` is null
         because "unlimited" is its own claim. The old version of this loop
         asserted every value was non-empty, which migration 014 would have
         turned into a demand that the seed invent figures. What must hold is
         that every FIELD IS PRESENT — an absent key means the parser stopped
         reading that column, which is the failure this file exists for. */
      for (const [k, v] of Object.entries(r)) {
        assert.ok(v !== undefined, `${where}: ${r.slug}.${k} was never read`)
      }
    }
  }
})

test('the two column lists are the same columns in the same order', () => {
  assert.deepEqual(ingest.columns, seed.columns)
  /* 31 columns: 28 compared, room_id, and the two fetch stamps. */
  assert.equal(seed.columns.length, 31)
  for (const c of NOT_COMPARED) assert.ok(seed.columns.includes(c), `${c} is not in the insert at all`)
})

/**
 * THE TERM FAMILY, BY NAME. The count assertion above catches a column being
 * dropped only if nobody lowers the count with it. These ten are the reason
 * migration 014 exists and they are the ones a future tidy-up is most likely to
 * decide are "not really part of the daily", so they are pinned individually.
 */
test('every rebuy and add-on column is actually being compared', () => {
  const expected = ['rebuy_amount', 'rebuy_chips', 'rebuy_max', 'rebuy_unlimited',
    'rebuy_max_stack', 'rebuy_window', 'addon_amount', 'addon_chips', 'addon_max', 'addon_window']
  for (const c of expected) {
    assert.ok(seed.columns.includes(c), `${c} is not in the seed's insert`)
    assert.ok(ingest.columns.includes(c), `${c} is not in the ingest's insert`)
  }
  const friday = seed.rows.find((r) => r.slug === 'wynn-daily-240-nlh-rebuy-40k')
  assert.equal(friday.rebuyAmount, 200)
  assert.equal(friday.rebuyUnlimited, true)
  assert.equal(friday.rebuyMaxStack, 15000)
  assert.equal(friday.rebuyChips, null, 'Wynn publishes no chip figure for a rebuy')
  assert.equal(friday.rebuyMax, null, 'unlimited is not spelled as a count')
})

/**
 * ⚠️ THE NOTE AND THE COLUMNS ARE THE SAME CLAIM, TWICE. `reentry_note` holds
 * the room's sentence verbatim and the term columns hold it structured, and
 * nothing writes one from the other. So the sentence is parsed and compared to
 * the columns, for every daily, on both copies — which is what stops the prose
 * and the figures drifting into contradicting each other on the same card.
 */
test('the verbatim note and the stored terms say the same thing, on every daily', () => {
  for (const [where, rows] of [['seed', seed.rows], ['ingest', ingest.rows]]) {
    for (const r of rows) {
      const parsed = parseTerms(r.reentryNote)
      assert.ok(parsed.ok, `${where} ${r.slug}: the note could not be read — ${parsed.ok === false ? parsed.why : ''}`)
      const t = parsed.terms
      assert.equal(t.rebuyAmount, r.rebuyAmount, `${where} ${r.slug}: rebuy amount`)
      assert.equal(t.rebuyUnlimited, r.rebuyUnlimited, `${where} ${r.slug}: unlimited`)
      assert.equal(t.rebuyMax, r.rebuyMax, `${where} ${r.slug}: rebuy count`)
      assert.equal(t.rebuyMaxStack, r.rebuyMaxStack, `${where} ${r.slug}: eligibility threshold`)
      assert.equal(t.rebuyChips, r.rebuyChips, `${where} ${r.slug}: rebuy chips`)
      assert.equal(t.addonAmount, r.addonAmount, `${where} ${r.slug}: add-on amount`)
      assert.equal(t.addonMax, r.addonMax, `${where} ${r.slug}: add-on count`)
      assert.equal(t.addonChips, r.addonChips, `${where} ${r.slug}: add-on chips`)
      assert.equal(t.rebuyWindow, r.rebuyWindow, `${where} ${r.slug}: rebuy window`)
      assert.equal(t.addonWindow, r.addonWindow, `${where} ${r.slug}: add-on window`)
      /* The note also states when registration closes, and the row stores it
         separately — two more chances to disagree. */
      assert.equal(t.closesAtLevel, r.lateRegLevel, `${where} ${r.slug}: late reg level`)
      assert.equal(t.reentryAllowed, r.reentryAllowed, `${where} ${r.slug}: re-entry`)
    }
  }
})

test('and that cross-check can fail — a note edited away from its columns is caught', () => {
  const friday = seed.rows.find((r) => r.slug === 'wynn-daily-240-nlh-rebuy-40k')
  const lying = parseTerms(friday.reentryNote.replace('$100 add-on', '$150 add-on'))
  assert.ok(lying.ok)
  assert.notEqual(lying.terms.addonAmount, friday.addonAmount)
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
