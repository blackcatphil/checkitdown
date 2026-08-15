#!/usr/bin/env node
/**
 * MIGRATION 023, FORCED RATHER THAN OBSERVED.
 *
 * 023 adds `new_activated` and `reactivated` and asserts that
 *
 *   weekly_active_people = new_reach + returned_from_prior + reactivated
 *
 * The `do $$` block at the bottom of the migration checks that against whatever
 * weeks happen to exist. On a fresh database that is NO WEEKS, so it passes
 * without testing anything — the same vacuity that has bitten this repo twice.
 *
 * ⚠️ SO THIS BUILDS THE POPULATIONS BY HAND. Devices are inserted with a
 * controlled `first_seen_at` and events at controlled timestamps, so each of
 * the three terms is non-zero and each is non-zero for a different reason. A
 * partition is only proved by a case that would land in the wrong bucket if a
 * definition were off by one clause.
 *
 * THE CASES, and what each would break:
 *
 *   NEW + ACTIVATES     first seen this week, decision, outbound.
 *                       Must count in new_reach AND new_activated.
 *   NEW + NO OUTBOUND   first seen this week, decision, no outbound.
 *                       Must count in new_reach and NOT in new_activated —
 *                       this is the case that makes the funnel a funnel. If
 *                       new_activated were the brief's literal definition the
 *                       two would be equal here and the ratio would be 100%.
 *   RETURNING + ACTIVE  seen last week, active last week, active this week.
 *                       returned_from_prior, and NOT reactivated.
 *   REACTIVATED         seen three weeks ago, silent last week, active now.
 *                       reactivated, and NOT new_reach, NOT returned.
 *
 * ⚠️ IT ASSERTS DELTAS, NOT TOTALS, AND THE FIRST VERSION DID NOT.
 * The local database already held sixteen devices first-seen this week from
 * earlier probe runs. Against those totals `new_activated < new_reach` was true
 * whatever this gate inserted — 2 < 16 — so the assertion that makes the funnel
 * a funnel was passing on unrelated pollution. Reading the row before and after
 * and asserting the CHANGE isolates this gate's four devices from whatever else
 * the database is carrying, and makes the numbers the same on a clean database
 * and a dirty one.
 *
 * LOCAL ONLY. It writes events and devices, then removes them and asserts the
 * removal — an analytics row left behind is a figure on a screen somebody reads.
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'
import { localTarget } from './db-target.mjs'

const PSQL = resolvePsql()
const DB = localTarget('migration-023-gate')

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

let failed = 0
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

const TAG = 'cid-023'

/** device_id values are opaque tokens; these are recognisable so cleanup is exact. */
const D = {
  newActivates: `${TAG}-new-activates`,
  newNoOutbound: `${TAG}-new-no-outbound`,
  returning: `${TAG}-returning`,
  reactivated: `${TAG}-reactivated`,
}

console.log('\n== MIGRATION 023: the funnel and the three-term partition ==')

try {
  /* THIS WEEK's Monday, and the two before it, computed by the database so the
     test and the view agree about where a week starts. */
  const thisWeek = sql(`select date_trunc('week', now())::date`)
  const lastWeek = sql(`select (date_trunc('week', now()) - interval '7 days')::date`)
  const threeAgo = sql(`select (date_trunc('week', now()) - interval '21 days')::date`)

  /* Devices, each with a first_seen_at that decides which bucket it belongs in.
     `analytics.devices` is never updated after insert, which is what makes
     "new" mean ever — so this column is the whole test. */
  /* The row as it stands BEFORE this gate touches anything. */
  const readWeek = () => {
    sql(`select analytics.refresh_weekly()`)
    const r = sql(`
      select weekly_active_people || '|' || new_reach || '|' || activated || '|'
          || new_activated || '|' || returned_from_prior || '|' || reactivated
        from analytics.weekly where iso_week = '${thisWeek}'`)
    const [wap, reach, act, newAct, returned, react] = (r || '0|0|0|0|0|0').split('|').map(Number)
    return { wap, reach, act, newAct, returned, react }
  }
  const before = readWeek()

  sql(`
    insert into analytics.devices (device_id, first_seen_at) values
      ('${D.newActivates}',  timestamptz '${thisWeek}' + interval '2 hours'),
      ('${D.newNoOutbound}', timestamptz '${thisWeek}' + interval '3 hours'),
      ('${D.returning}',     timestamptz '${lastWeek}' + interval '2 hours'),
      ('${D.reactivated}',   timestamptz '${threeAgo}' + interval '2 hours')
    on conflict (device_id) do update set first_seen_at = excluded.first_seen_at`)

  /* Events. `room_facts_view` is a decision surface; `outbound_room_click` is
     the conversion. Neither internal nor bot, or the single filter drops them. */
  /* ⚠️ `session_id` AND `bot_rules_version` ARE NOT NULL. The first local run
     of this gate died on session_id, which is the schema saying an event
     without a session is not an event. One session per device per week is
     enough: nothing here counts sessions, and reusing one across weeks would
     make a device look continuously present. */
  const ev = (device, name, week, hours) => sql(`
    insert into analytics.events
      (device_id, session_id, event_name, occurred_at, is_internal, bot, bot_rules_version)
    values ('${device}', '${device}-${week}', '${name}',
            timestamptz '${week}' + interval '${hours} hours', false, false, 'gate-023')`)

  ev(D.newActivates, 'room_facts_view', thisWeek, 4)
  ev(D.newActivates, 'outbound_room_click', thisWeek, 5)

  ev(D.newNoOutbound, 'room_facts_view', thisWeek, 4)

  ev(D.returning, 'room_facts_view', lastWeek, 4)
  ev(D.returning, 'room_facts_view', thisWeek, 4)

  ev(D.reactivated, 'room_facts_view', threeAgo, 4)
  ev(D.reactivated, 'room_facts_view', thisWeek, 4)

  const after = readWeek()
  const d = Object.fromEntries(
    Object.keys(before).map((k) => [k, after[k] - before[k]]))
  console.log(`\n  this week absolute: wap=${after.wap} new_reach=${after.reach} `
    + `new_activated=${after.newAct} returned=${after.returned} reactivated=${after.react}`)
  console.log(`  this gate's delta:  wap=+${d.wap} new_reach=+${d.reach} `
    + `new_activated=+${d.newAct} returned=+${d.returned} reactivated=+${d.react}\n`)

  // ─── 1. THE FUNNEL ───────────────────────────────────────────────────
  ok('the four devices land in the week at all — without this every delta below '
    + 'is zero and every assertion passes',
    d.wap === 4, `wap moved by ${d.wap}, expected 4`)

  ok('a NEW device that activates counts in new_reach AND new_activated',
    d.reach === 2 && d.newAct === 1,
    `new_reach +${d.reach} (expected 2), new_activated +${d.newAct} (expected 1)`)

  /* ⚠️ THE ASSERTION THAT MAKES THE RATIO MEAN ANYTHING, and the reason this
     gate measures deltas. TWO new devices went in and ONE of them went
     outbound. If `new_activated` were the brief's literal definition — first
     seen this week AND reached a decision surface — this delta would be 2 and
     the funnel would read 100% forever. Against absolute totals on a database
     already holding sixteen new devices, that mistake was invisible. */
  ok('RED — the NEW device that does NOT go outbound moves new_reach and NOT '
    + 'new_activated, so the funnel is a funnel',
    d.reach - d.newAct === 1,
    `new_reach +${d.reach} vs new_activated +${d.newAct} — exactly one newcomer did not convert`)

  ok('...and new_activated can never exceed new_reach',
    after.newAct <= after.reach, `${after.newAct} <= ${after.reach}`)

  // ─── 2. THE PARTITION ────────────────────────────────────────────────
  ok('a RETURNING device that activates moves returned_from_prior and nothing else',
    d.returned === 1, `returned_from_prior +${d.returned}, expected 1`)
  ok('a device seen three weeks ago and silent last week moves reactivated only',
    d.react === 1, `reactivated +${d.react}, expected 1`)

  /* ⚠️ THE IDENTITY, ON A WEEK THAT ACTUALLY HOLDS ALL THREE. The migration's
     own `do $$` block checks this too, and on an empty database it checks it
     against nothing. */
  ok('THE PARTITION HOLDS: wap = new_reach + returned + reactivated',
    after.wap === after.reach + after.returned + after.react,
    `${after.wap} = ${after.reach} + ${after.returned} + ${after.react}`)

  /* Disjointness, stated as a delta: four devices went in, and the three terms
     between them moved by exactly four. A device counted twice would move the
     sum by five while wap moved by four. */
  ok('...and no device lands in two terms — four devices moved the three terms '
    + 'by four in total',
    d.reach + d.returned + d.react === 4,
    `+${d.reach} +${d.returned} +${d.react} = ${d.reach + d.returned + d.react}`)

  // ─── 3. THE MIGRATION'S OWN GUARD, RE-RUN ────────────────────────────
  const bad = sql(`
    select count(*) from analytics.weekly
     where weekly_active_people <> new_reach + returned_from_prior + reactivated`)
  ok('and no OTHER week in the view breaks the partition either', bad === '0',
    `${bad} week(s) fail`)

} finally {
  const ids = Object.values(D).map((d) => `'${d}'`).join(',')
  sql(`delete from analytics.events where device_id in (${ids})`)
  sql(`delete from analytics.devices where device_id in (${ids})`)
  sql(`delete from analytics.devices where device_id in (${ids})`)
  sql(`select analytics.refresh_weekly()`)
  const left = sql(`select count(*) from analytics.devices where device_id like '${TAG}%'`)
  ok('the gate left no device behind — a stray row is a figure somebody reads',
    left === '0', `${left} remaining`)
}

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
