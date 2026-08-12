#!/usr/bin/env node
/**
 * ⚠️ PORT INSTRUMENT, NOT A GATE. This exists for the one-off job of moving the
 * Wynn ingest onto the shared rails. It CANNOT run in CI — the snapshot half
 * needs production credentials and the diff half needs a fixture taken from a
 * live database — and it guards nothing on an ongoing basis. Nobody should
 * later assume a green run here means the pipeline is checked.
 *
 * THE EQUIVALENCE PROOF — local, row by row, column by column, against the
 * production snapshot.
 *
 * ⚠️ THE FAILURE THIS EXISTS FOR IS ONE COLUMN QUIETLY DIFFERING ACROSS 659
 * ROWS. Porting the Wynn ingest onto the shared rails is supposed to change
 * NOTHING. Every check that already exists reads the RESULT — 22 templates, 61
 * instances, 659 levels, contiguity, monotonicity — and every one of them would
 * still pass if a port silently changed `game` on three rows, or moved
 * `bounty_amount` from NULL to 0, or started writing `published_buy_in`. The
 * counts would be right. The shape would be right. The data would be different.
 *
 * So this compares VALUES, not counts:
 *
 *   · rows missing from local that the snapshot has
 *   · rows in local the snapshot does not have
 *   · every compared column of every matched row, as text, exactly
 *
 * The column list and the queries are IMPORTED from `wynn-snapshot.mjs` rather
 * than restated, so the "before" and "after" halves are structurally incapable
 * of asking different questions.
 *
 *   DATABASE_URL=... node scripts/wynn-diff.mjs [fixtures/wynn-prod-YYYY-MM-DD.tsv]
 *
 * Exits non-zero on any difference. Zero differences is the only pass.
 */
import { readFileSync, readdirSync } from 'node:fs'

import { localTarget } from './db-target.mjs'
import { QUERIES, dump } from './wynn-snapshot.mjs'

/* ⚠️ localTarget, NOT prodTarget. This runs the comparison against a database
   the ingest has just written to, and the ingest under test is not allowed
   anywhere near production during the port. */
const DB = localTarget('wynn-diff')

const FIXTURE = process.argv[2] ?? (() => {
  const found = readdirSync('fixtures').filter((f) => /^wynn-prod-.*\.tsv$/.test(f)).sort()
  if (!found.length) {
    console.error('\nNo snapshot in fixtures/. Take one first:'
      + '\n  PROD_DATABASE_URL=... node scripts/wynn-snapshot.mjs\n')
    process.exit(2)
  }
  return `fixtures/${found.at(-1)}`
})()

/** The fixture back into {table: Map(key -> {col: value})}. */
function loadFixture(path) {
  const out = {}
  const headers = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    /* ⚠️ `## ` IS TESTED FIRST. The fence comments start with `#` and so does a
       section header, so skipping comments first swallowed every header — no
       columns registered, every section empty, and the diff reported all 746
       rows as "present locally, absent from the snapshot". It failed loudly,
       which is the only reason it was obvious; a harness that had defaulted to
       "no rows means nothing to compare" would have reported zero differences
       and been believed. */
    if (line.startsWith('## ')) {
      const [name, ...cols] = line.slice(3).split('\t')
      headers[name] = cols
      out[name] = new Map()
      continue
    }
    if (!line || line.startsWith('#')) continue
    const [name, ...vals] = line.split('\t')
    if (!headers[name]) continue
    const row = Object.fromEntries(headers[name].map((c, i) => [c, vals[i]]))
    out[name].set(keyOf(name, row), row)
  }
  return { tables: out, headers }
}

/**
 * ⚠️ THE KEY IS THE ROW'S IDENTITY, NOT ITS POSITION. Comparing the two dumps
 * line by line would work only while both sides hold exactly the same rows in
 * exactly the same order — so a single missing level would report every
 * subsequent row as different, and the real finding (one row absent) would be
 * buried under 600 false ones.
 */
function keyOf(table, r) {
  if (table === 'templates') return r.slug
  if (table === 'instances') return `${r.template_slug} @ ${r.starts_at}`
  return `${r.template_slug} ${r.game_type} L${r.level_number}`
}

function localRows(table) {
  const [q, cols] = QUERIES[table]
  const body = dump(DB, q)
  const m = new Map()
  for (const line of body ? body.split('\n') : []) {
    const vals = line.split('\t')
    const row = Object.fromEntries(cols.map((c, i) => [c, vals[i]]))
    m.set(keyOf(table, row), row)
  }
  return m
}

const { tables: fixture, headers } = loadFixture(FIXTURE)
console.log(`\nWYNN EQUIVALENCE DIFF`)
console.log(`  snapshot: ${FIXTURE}`)

/* The fence, read back and asserted. A fixture that lost its header could be
   mistaken for a data file, which is the thing the header exists to prevent. */
const head = readFileSync(FIXTURE, 'utf8').slice(0, 2000)
if (!/NOT A SOURCE OF TRUTH/.test(head)) {
  console.error('  ⚠️  the snapshot has lost its "NOT A SOURCE OF TRUTH" header — refusing to '
    + 'use a fixture that no longer says what it is.')
  process.exit(2)
}

let differences = 0
const report = (table, key, col, want, got) => {
  differences++
  if (differences <= 40) {
    console.log(`  DIFF  ${table}  ${key}`)
    console.log(`          ${col}: snapshot ${fmt(want)}  ·  local ${fmt(got)}`)
  }
}
/* `\N` printed as NULL and quoted otherwise, so "NULL" and the four-character
   string "NULL" cannot read the same in a report about exactly that confusion. */
const fmt = (v) => (v === undefined ? '(row absent)' : v === '\\N' ? 'NULL' : JSON.stringify(v))

for (const table of Object.keys(QUERIES)) {
  const want = fixture[table] ?? new Map()
  const got = localRows(table)
  const cols = headers[table] ?? []

  for (const [key, wrow] of want) {
    const grow = got.get(key)
    if (!grow) { report(table, key, '(whole row)', 'present', undefined); continue }
    for (const c of cols) {
      /* Compared as TEXT, exactly. No numeric coercion anywhere: `0` and `0.00`
         are different renderings and a port that changed one to the other has
         changed the column's type or its expression, which is a real finding.
         And crucially `\N` (NULL) never equals `0` — the harness is required to
         catch exactly that. */
      if (wrow[c] !== grow[c]) report(table, key, c, wrow[c], grow[c])
    }
  }
  for (const [key] of got) {
    if (!want.has(key)) report(table, key, '(whole row)', undefined, 'present')
  }
  console.log(`  ${table}: snapshot ${want.size} rows · local ${got.size} rows`)
}

if (differences > 40) console.log(`  … and ${differences - 40} more`)
console.log(`\n  ${differences} difference(s)\n`)
process.exit(differences ? 1 : 0)
