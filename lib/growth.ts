import { Pool } from 'pg'

import { EVENT_NAMES, RATE_LIMIT } from './analytics-events.ts'
import { BOT_RULES_VERSION } from './bot.ts'

/**
 * WHAT THE GROWTH CONSOLE READS.
 *
 * ⚠️ NOT OVER PostgREST. The `analytics` schema is deliberately not exposed to
 * it (migration 017), so supabase-js cannot reach the roll-up with any key.
 * This goes through `public.growth_weekly()` — SECURITY DEFINER, EXECUTE
 * granted to `cid_events_writer` only — over the same pooled connection the
 * write path uses. Reusing that pool is deliberate: one credential, one door,
 * and the app still holds no service key.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/growth.ts is server-only — it opens a Postgres connection')
}

const url = process.env.CID_EVENTS_DATABASE_URL

declare global {
  /* `var` attaches to globalThis, which is what survives a dev hot reload. */
  var __cidGrowthPool: Pool | undefined
}

function pool(): Pool | null {
  if (!url) return null
  if (globalThis.__cidGrowthPool) return globalThis.__cidGrowthPool
  const p = new Pool({
    connectionString: url,
    statement_timeout: 4000,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 4000,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  })
  p.on('error', (e) => console.error('[growth] idle client error:', e.message))
  globalThis.__cidGrowthPool = p
  return p
}

export type Week = {
  iso_week: string
  week_ends: string
  is_complete: boolean
  weekly_active_people: number
  new_reach: number
  activated: number
  /** Of the devices first seen this week, those that reached an outbound
   *  click. A subset of `new_reach` by construction — migration 023. */
  new_activated: number
  prior_week_active: number
  returned_from_prior: number
  /** Active this week, seen before, NOT active last week. The third term the
   *  prototype's two-term sum drops — migration 023. */
  reactivated: number
  outbound_clicks: number
}

export type Rollup = {
  /** Every week the roll-up holds, oldest first. May be empty. */
  weeks: Week[]
  /** Complete weeks only — the ones the console may present as a reading. */
  complete: Week[]
  /** The earliest event, for deriving `first reading <date>`. Null if none. */
  earliestEvent: Date | null
  refreshedAt: Date | null
  /** The newest event the roll-up can see — for telling a stale view from a
   *  stopped producer. */
  latestEvent: Date | null
  /** True when the roll-up could not be read at all — a fault, not an absence. */
  unreachable: boolean
}

export async function readRollup(): Promise<Rollup> {
  const p = pool()
  const empty: Rollup = {
    weeks: [], complete: [], earliestEvent: null, latestEvent: null,
    refreshedAt: null, unreachable: true,
  }
  if (!p) return empty
  try {
    const { rows } = await p.query('select * from public.growth_weekly()')
    const { rows: meta } = await p.query('select public.growth_refreshed_at() as at')
    const { rows: last } = await p.query('select public.growth_latest_event() as at')
    /* ⚠️ FROM THE EVENTS, NOT THE ROLL-UP. Deriving this from the matview was
       circular: a stale view holds no weeks, so no date could be computed, so
       every cell fell through to "no producer exists". A stale roll-up must
       never be able to impersonate an absent one. */
    const { rows: first } = await p.query('select public.growth_earliest_event() as at')
    /* ⚠️ `pg` RETURNS A `date` COLUMN AS A JS Date, NOT A STRING, and React
       cannot render a Date as a child — the Engine tab threw and produced no
       <main> at all until this was added. The type said `string`, which is what
       the rest of the console wants, so the coercion belongs here at the
       boundary rather than at every call site. */
    const weeks = (rows as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      iso_week: r.iso_week instanceof Date
        ? r.iso_week.toISOString().slice(0, 10) : String(r.iso_week),
      week_ends: r.week_ends instanceof Date
        ? r.week_ends.toISOString().slice(0, 10) : String(r.week_ends),
    })) as Week[]
    /* ⚠️ THE EARLIEST EVENT COMES FROM THE ROLL-UP'S OWN FIRST WEEK, not a
       second query against `events`. Two sources for "when did this start"
       would drift, and the date the console prints has to be the one the
       numbers are computed from. */
    return {
      weeks,
      complete: weeks.filter((w) => w.is_complete),
      earliestEvent: first[0]?.at ? new Date(first[0].at) : null,
      refreshedAt: meta[0]?.at ? new Date(meta[0].at) : null,
      latestEvent: last[0]?.at ? new Date(last[0].at) : null,
      unreachable: false,
    }
  } catch (e) {
    /* ⚠️ UNREACHABLE IS NOT ABSENT. If the roll-up cannot be read the console
       must say so rather than render every cell as an em-dash, which would be
       indistinguishable from "no producer exists" — the exact confusion this
       whole console is built to prevent. */
    console.error('[growth] roll-up unreadable:', e instanceof Error ? e.message : String(e))
    return empty
  }
}

/**
 * ⚠️ THE PER-CLICK RATE IS NOT IN CODE, AND MUST NOT BE.
 *
 * No room pays for a click today. A number here would flow straight into a
 * revenue line and become a figure somebody quotes — invented money, which is
 * the one thing worse than an invented metric. Unset means every revenue line
 * reads "no rate set" until a room actually signs.
 */
export const REVENUE_PER_CLICK: number | null =
  process.env.CID_REVENUE_PER_CLICK ? Number(process.env.CID_REVENUE_PER_CLICK) : null

/**
 * ⚠️ WHAT EACH EVENT FIRES ON, AND WHAT IT FEEDS — READ OFF THE CODE, NOT
 * INVENTED.
 *
 * `when` restates the doc comment on each name in `lib/analytics-events.ts`;
 * `feeds` restates what migration 021's roll-up actually does with it. Both are
 * descriptions of behaviour that already exists, which is the only kind of
 * prose allowed on this page — the prototype's ten-event table is the
 * designer's invention (readme.md:35) and none of it crosses.
 *
 * A name added to EVENT_NAMES without an entry here fails `growth-spec.test.mjs`,
 * so the table cannot quietly fall behind the enum.
 */
export const EVENT_FACTS: Record<string, { when: string; props: string; feeds: string }> = {
  room_facts_view: {
    when: 'a room\u2019s facts grid becomes visible, fired on mount in the browser',
    props: 'room slug',
    feeds: 'weekly active people, new reach',
  },
  map_filter_apply: {
    when: 'a filter is applied on the map',
    props: 'which filter, and its value',
    feeds: 'nothing — browsing is not a decision',
  },
  tournament_row_open: {
    when: 'a tournament row is opened from /tournaments',
    props: 'room slug',
    feeds: 'weekly active people, new reach',
  },
  outbound_room_click: {
    when: 'a reader leaves for the room\u2019s own property — site, directions, phone, PDF',
    props: 'room slug, which surface',
    feeds: 'weekly active people, new reach, activated, new activated, outbound clicks',
  },
  source_link_click: {
    when: 'a reader opens the source behind a figure — checking our work',
    props: 'room slug, host_is_room',
    feeds: 'weekly active people, new reach',
  },
  fact_report_submit: {
    when: 'a correction is submitted, fired after the insert succeeds',
    props: 'room slug, which field',
    feeds: 'nothing yet — not aggregated by the weekly roll-up',
  },
  install_accept: {
    when: 'the browser install prompt is accepted, read from userChoice',
    props: 'none',
    feeds: 'nothing — an outcome, not a visit',
  },
}

/**
 * WHAT THE SPEC TAB PRINTS — generated from the same constants the queries use,
 * so it cannot drift from what is measured. A spec page maintained by hand is a
 * spec page that describes last month's pipeline.
 */
export const SPEC = {
  eventNames: EVENT_NAMES,
  eventFacts: EVENT_FACTS,
  /* Kept in step with `analytics.decision_events()`; the Spec tab prints both
     and the console asserts they match. */
  decisionEvents: ['room_facts_view', 'outbound_room_click',
    'source_link_click', 'tournament_row_open'] as const,
  rateLimit: RATE_LIMIT,
  botRulesVersion: BOT_RULES_VERSION,
  notCounted: [
    ['our own traffic', '`is_internal` is set by the client and never cleared by a request'],
    ['bots', 'classified at write time from the user-agent, which is not stored'],
    ['incomplete weeks', 'a week in progress is never presented as a reading'],
    ['builds', 'every event fires from a client component; a cached server render counts nothing'],
  ],
  sources: [
    ['analytics.events', 'the seven events above, written through one SECURITY DEFINER door'],
    ['analytics.devices', 'one row per device, never deleted — what makes "new" mean ever'],
    ['the room tables', 'coverage and verification, read from the facts themselves'],
  ],
  guardrails: [
    ['no IP, no user-agent, no referrer', 'migration 017 — one bot bit is stored, not the string'],
    ['no personal data', '`device_id` is a random token in localStorage, not a fingerprint'],
    ['usage sits outside the precedence law', 'a click is not evidence about a poker room'],
    ['rate limited', `${RATE_LIMIT.events} events per ${RATE_LIMIT.windowMs / 1000}s per session`],
  ],
} as const
