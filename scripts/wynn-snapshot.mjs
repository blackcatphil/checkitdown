#!/usr/bin/env node
/**
 * ⚠️ PORT INSTRUMENT, NOT A GATE. This exists for the one-off job of moving the
 * Wynn ingest onto the shared rails. It CANNOT run in CI — the snapshot half
 * needs production credentials and the diff half needs a fixture taken from a
 * live database — and it guards nothing on an ongoing basis. Nobody should
 * later assume a green run here means the pipeline is checked.
 *
 * SNAPSHOT WYNN'S TOURNAMENT ROWS FROM PRODUCTION — read-only, deterministic.
 *
 * This is the "before" half of the port's equivalence proof. It is evidence,
 * and it is the only copy of what production held before anything moved.
 *
 * ⚠️ WHAT IS COMPARED AND WHAT IS NOT, decided here rather than in the diff, so
 * the exclusions are one list somebody can audit instead of being scattered
 * through a comparison.
 *
 * IDENTITY — used to line rows up, never diffed:
 *   templates   slug
 *   instances   template slug + starts_at
 *   levels      template slug + game_type + level_number
 *
 * EXCLUDED, and every one has to earn it:
 *   id, room_id, series_id, template_id   surrogate keys. Random uuids that
 *                                         differ between any two databases and
 *                                         say nothing about the data. `series_id`
 *                                         is replaced by the boolean
 *                                         `in_series`, because "is this a
 *                                         Signature Series row or a daily" IS
 *                                         meaningful — it is the difference
 *                                         between the 22 and the 4.
 *   created_at, updated_at                when the row was written.
 *   fetched_at, structure_fetched_at      when the DOCUMENT was fetched. The
 *                                         ingest stamps `now()`; a re-run is
 *                                         supposed to differ. Their presence is
 *                                         asserted separately (see `stamped`)
 *                                         so "excluded" cannot become "the port
 *                                         stopped writing them".
 *   source_id                             a join key to `sources`, set by
 *                                         nothing in this pipeline.
 *
 * EVERYTHING ELSE IS COMPARED, including the four columns `wynn.py` never
 * writes — advertised_as, published_buy_in, bounty_amount, is_break. Those are
 * precisely the ones a port is most likely to start writing by accident, and a
 * diff that skipped them would be silent about the most likely defect.
 *
 * ⚠️ NULLs ARE `\N`, NOT EMPTY. `copy ... to stdout` is used instead of a
 * plain select because psql prints NULL as an empty string, which makes NULL,
 * '' and (after a cast) 0 indistinguishable in the output. A diff built on that
 * would pass while `bounty_amount` moved from NULL to 0 — one of the two
 * failures this harness is required to catch.
 *
 *   PROD_DATABASE_URL=... node scripts/wynn-snapshot.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

import { resolvePsql } from './psql-path.mjs'
import { prodTarget, describe } from './db-target.mjs'

const PSQL = resolvePsql()
const ROOM = 'wynn-encore'
/* ⚠️ prodTarget() IS NOT CALLED AT IMPORT TIME. `wynn-diff.mjs` imports the
   queries and column lists from this file so the two cannot drift — and it runs
   against LOCAL. Resolving a production target on import would make the diff
   refuse to start for want of a credential it has no business holding. */
const OUT_DIR = 'fixtures'

/* Columns the diff compares, per table, in a fixed order. Written out rather
   than selected with `*`: a new column added by a later migration must be a
   deliberate decision to include, not something that silently appears in the
   snapshot and silently changes what "zero differences" means. */
export const TEMPLATE_COLS = [
  'slug', 'in_series', 'name', 'game', 'start_time', 'days_of_week',
  'entry_amount', 'fee_amount', 'bounty_amount', 'staff_amount', 'published_buy_in',
  'total_buy_in', 'fee_percent', 'guarantee_amount', 'guarantee_is_estimated',
  'starting_stack', 'level_minutes', 'level_length_note', 'pace',
  'late_reg_level', 'late_reg_close', 'reentry_allowed', 'reentry_note',
  'reliability', 'reliability_note', 'structure_pdf_url', 'structure_hash',
  'rebuy_amount', 'rebuy_chips', 'rebuy_max', 'rebuy_unlimited', 'rebuy_max_stack',
  'rebuy_window', 'addon_amount', 'addon_chips', 'addon_max', 'addon_window',
  'advertised_as', 'document_effective_on', 'document_date_source', 'source_url',
  'is_active', 'verified_at', 'stamped',
]
export const INSTANCE_COLS = [
  'template_slug', 'starts_at', 'entry_kind', 'takes_entry', 'is_cancelled', 'cancel_note',
]
export const LEVEL_COLS = [
  'template_slug', 'level_number', 'game_type', 'small_blind', 'big_blind',
  'ante', 'minutes', 'small_bet', 'big_bet', 'is_break',
]

/* `stamped` collapses the two excluded fetch timestamps into one comparable
   fact: BOTH present, one present, or neither. So the port cannot quietly stop
   citing its documents while the timestamps themselves stay out of the diff. */
const TEMPLATE_Q = `
  select t.slug,
         (t.series_id is not null) as in_series,
         t.name, t.game::text, t.start_time::text, t.days_of_week::text,
         t.entry_amount, t.fee_amount, t.bounty_amount, t.staff_amount, t.published_buy_in,
         t.total_buy_in, t.fee_percent, t.guarantee_amount, t.guarantee_is_estimated,
         t.starting_stack, t.level_minutes, t.level_length_note, t.pace,
         t.late_reg_level, t.late_reg_close::text, t.reentry_allowed, t.reentry_note,
         t.reliability::text, t.reliability_note, t.structure_pdf_url, t.structure_hash,
         t.rebuy_amount, t.rebuy_chips, t.rebuy_max, t.rebuy_unlimited, t.rebuy_max_stack,
         t.rebuy_window::text, t.addon_amount, t.addon_chips, t.addon_max, t.addon_window::text,
         t.advertised_as, t.document_effective_on::text, t.document_date_source, t.source_url,
         t.is_active, t.verified_at::text,
         (case when t.fetched_at is not null and t.structure_fetched_at is not null then 'both'
               when t.fetched_at is not null then 'fetched_at only'
               when t.structure_fetched_at is not null then 'structure only'
               else 'neither' end) as stamped
    from tournament_templates t join rooms r on r.id = t.room_id
   where r.slug = '${ROOM}'
   order by t.slug`

/* ⚠️ ORDERED BY THE IDENTITY, NOT BY id. A uuid order is stable within one
   database and meaningless across two, so an id-ordered snapshot would diff as
   "every row changed" against a faithful re-run. */
const INSTANCE_Q = `
  select t.slug as template_slug, i.starts_at::text, i.entry_kind, i.takes_entry,
         i.is_cancelled, i.cancel_note
    from tournament_instances i
    join tournament_templates t on t.id = i.template_id
    join rooms r on r.id = t.room_id
   where r.slug = '${ROOM}'
   order by t.slug, i.starts_at`

const LEVEL_Q = `
  select t.slug as template_slug, l.level_number, l.game_type, l.small_blind, l.big_blind,
         l.ante, l.minutes, l.small_bet, l.big_bet, l.is_break
    from tournament_levels l
    join tournament_templates t on t.id = l.template_id
    join rooms r on r.id = t.room_id
   where r.slug = '${ROOM}'
   order by t.slug, l.game_type, l.level_number`

export function dump(db, q) {
  return execFileSync(
    PSQL, [db, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', `copy (${q}) to stdout`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).replace(/\n$/, '')
}

export const QUERIES = {
  templates: [TEMPLATE_Q, TEMPLATE_COLS],
  instances: [INSTANCE_Q, INSTANCE_COLS],
  levels: [LEVEL_Q, LEVEL_COLS],
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const DB = prodTarget('wynn-snapshot')
  const today = execFileSync('/bin/date', ['+%Y-%m-%d'], { encoding: 'utf8' }).trim()
  const ref = (DB.match(/(rhsayldolpyfpzpknvrx)/) ?? ['unknown'])[0]

  const parts = []
  const counts = {}
  for (const [name, [q, cols]] of Object.entries(QUERIES)) {
    const body = dump(DB, q)
    const rows = body ? body.split('\n') : []
    counts[name] = rows.length
    parts.push(`## ${name}\t${cols.join('\t')}`)
    parts.push(...rows.map((r) => `${name}\t${r}`))
  }

  /* ⚠️ THE FENCE IS THE FIRST THING IN THE FILE, and the file is TSV rather
     than SQL on purpose: a table of values cannot be executed. This repo has
     already shipped seed-only rows as though they were done, so a fixture that
     could be mistaken for a source of truth — or fed to a seeder — is a real
     hazard rather than a theoretical one. */
  const header = [
    '# WYNN TOURNAMENT ROWS — POINT-IN-TIME SNAPSHOT OF PRODUCTION',
    `# taken:        ${today}`,
    `# project ref:  ${ref}`,
    `# source:       ${describe(DB)}`,
    `# room:         ${ROOM}`,
    `# rows:         templates ${counts.templates} · instances ${counts.instances}`
      + ` · levels ${counts.levels}`,
    '#',
    '# ⚠️ THIS IS A DIFF FIXTURE. IT IS NOT A SOURCE OF TRUTH.',
    '#',
    '# It exists so the Wynn ingest can be ported onto the shared rails and',
    '# PROVED to change nothing. It is evidence of what production held on the',
    '# date above, and it goes stale the moment Wynn publishes a new document.',
    '#',
    '# It must never be loaded into a database. Nothing here is authoritative:',
    '# the authority is the room\'s published PDFs and the ingest that reads',
    '# them. It lives outside supabase/ and is TSV rather than SQL so that it',
    '# is structurally incapable of being seeded.',
    '#',
    '# Surrogate keys, row timestamps and fetch timestamps are deliberately',
    '# absent — see the header of scripts/wynn-snapshot.mjs for the full list',
    '# and the reason each is excluded.',
    '',
  ].join('\n')

  mkdirSync(OUT_DIR, { recursive: true })
  const path = `${OUT_DIR}/wynn-prod-${today}.tsv`
  writeFileSync(path, header + parts.join('\n') + '\n')
  console.log(`\n  wrote ${path}`)
  console.log(`    templates ${counts.templates} · instances ${counts.instances}`
    + ` · levels ${counts.levels}\n`)
}
