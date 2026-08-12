import { Pool } from 'pg'

import { RATE_LIMIT } from './analytics-events.ts'

/**
 * THE WRITE PATH — a role that can do exactly one thing, over the pooler.
 *
 * ═══ NO SERVICE KEY. THE STANDING RULE HOLDS. ═══
 *
 * `lib/supabase-admin.ts` says "THERE IS NO SERVICE-ROLE CLIENT IN THIS
 * CODEBASE, and that is the design. A service key in the app would make every
 * route a potential full-database write path." An earlier draft of this file
 * broke that rule and asked for a ruling; the ruling was that the rule stands,
 * and `SUPABASE_SERVICE_ROLE_KEY` does not enter the app environment.
 *
 * What the app holds instead is `cid_events_writer`: a Postgres role with
 * USAGE on the analytics schema, EXECUTE on `public.record_events`, and nothing
 * else. No ownership. NO INSERT ON THE TABLE — see migration 017 — so the
 * function stays the single door and a leaked credential costs one append-only
 * table rather than the database.
 *
 * ═══ ⚠️ TRANSACTION-MODE POOLER, AND WHY PREPARED STATEMENTS ARE OFF ═══
 *
 * The connection goes to Supabase's pooler on port 6543 (TRANSACTION mode), not
 * to Postgres on 5432. In transaction mode a client is handed a backend for the
 * duration of ONE TRANSACTION and it is then returned to the pool for somebody
 * else — which is what makes it survivable from a serverless runtime where
 * every invocation may be a new process.
 *
 * It also makes PREPARED STATEMENTS UNUSABLE. A prepared statement lives in the
 * session on one specific backend; the pooler hands the next query to a
 * different backend that has never heard of it, and the failure is
 * `prepared statement "s1" does not exist` — intermittent, load-dependent, and
 * absent from every local test against a direct connection. node-postgres only
 * prepares when a query is given a `name`, so the rule here is that no query in
 * this file has one, and `statement_timeout` is set as a pool parameter rather
 * than by issuing a SET that would not survive the connection being handed on.
 *
 * Port 5432 is SESSION mode and would allow prepared statements — and would
 * also hold a backend open per idle serverless instance until the database
 * refuses new ones. Transaction mode is the right trade; this comment exists so
 * the next person does not "fix" the absent prepared statements.
 */

const url = process.env.CID_EVENTS_DATABASE_URL

/**
 * ONE POOL PER PROCESS, cached across hot reloads.
 *
 * Next re-evaluates modules on every edit in development, and a new Pool per
 * evaluation leaks connections until the database refuses more — which presents
 * as the analytics endpoint working for twenty minutes and then not.
 */
declare global {
  /* `var`, not `let` — only `var` declarations attach to globalThis, which is
     what makes the cache survive a module re-evaluation. (No eslint-disable:
     this config does not enable `no-var`, and a dead directive is itself a
     lint warning.) */
  var __cidEventsPool: Pool | undefined
}

function pool(): Pool | null {
  if (!url) return null
  if (globalThis.__cidEventsPool) return globalThis.__cidEventsPool
  const p = new Pool({
    connectionString: url,
    statement_timeout: 4000,
    /* Small on purpose: the pooler is doing the real pooling, and a large
       client-side pool against a transaction pooler just holds slots the
       platform is already rationing. */
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 4000,
    /* The hosted pooler terminates TLS with its own chain; a local one does
       not speak TLS at all. */
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  })
  /* An unhandled 'error' from a pool takes the process down. An analytics
     endpoint must never be able to do that. */
  p.on('error', (e) => console.error('[analytics] idle client error:', e.message))
  globalThis.__cidEventsPool = p
  return p
}

export type EventRow = {
  event_name: string
  device_id: string
  session_id: string
  room_id: string | null
  props: Record<string, unknown>
  is_internal: boolean
  bot: boolean
  bot_rules_version: string
}

/**
 * Write a batch through the one door. Returns what the database says it wrote,
 * or null when the writer is not configured.
 *
 * ⚠️ ONE STATEMENT, ONE TRANSACTION, NO `name` ON THE QUERY. The whole batch is
 * a single `select public.record_events($1)` with the rows as one jsonb
 * parameter — which is also why transaction mode is sufficient: nothing here
 * needs state to survive between statements.
 */
export async function writeEvents(rows: EventRow[]): Promise<number | null> {
  const p = pool()
  if (!p) return null
  const { rows: out } = await p.query(
    'select public.record_events($1::jsonb) as n',
    [JSON.stringify(rows)],
  )
  return Number(out[0]?.n ?? 0)
}

export const analyticsConfigured = (): boolean => Boolean(url)

/**
 * PER-SESSION RATE LIMIT, IN MEMORY.
 *
 * ⚠️ ITS LIMIT IS STATED RATHER THAN HIDDEN: this is per server instance. On a
 * platform running several, a caller gets the limit times the number of
 * instances. That is fine for what this is for — stopping a loop or a stuck
 * `useEffect` from writing ten thousand rows — and it is not a security
 * control. Anything that needed to be one would have to live in the database
 * and would cost a round trip on every event.
 */
const hits = new Map<string, number[]>()

export function rateLimited(sessionId: string, count: number): boolean {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT.windowMs
  const seen = (hits.get(sessionId) ?? []).filter((t) => t > cutoff)
  if (seen.length + count > RATE_LIMIT.events) {
    hits.set(sessionId, seen)
    return true
  }
  for (let i = 0; i < count; i++) seen.push(now)
  hits.set(sessionId, seen)

  /* Unbounded growth is the failure mode of every in-memory limiter. Swept when
     the map gets large rather than on a timer, so an idle instance does no
     work. */
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k)
  }
  return false
}

/** Test seam: the limiter is process-global, so a suite that fires the same
 *  session twice would otherwise inherit the previous test's window. */
export const resetRateLimit = () => hits.clear()
