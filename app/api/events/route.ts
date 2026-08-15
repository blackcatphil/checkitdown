import { NextResponse } from 'next/server'

import { MAX_BATCH, isEventName, type ClientEvent } from '@/lib/analytics-events'
import { analyticsConfigured, rateLimited, writeEvents } from '@/lib/analytics-server'
import { BOT_RULES_VERSION, isBot } from '@/lib/bot'
import { supabase } from '@/lib/supabase'

/**
 * THE ONLY WRITE PATH INTO `analytics.events`.
 *
 * Nothing reaches that table from a browser. The schema is not exposed to
 * PostgREST at all — proven over HTTP as anon, which answers
 * "Only the following schemas are exposed: public, graphql_public" — so there
 * is no REST route for a client to call even holding a key. This handler is it.
 *
 * ⚠️ NEVER STATIC, NEVER CACHED. A route that counted once per build and served
 * the answer from a cache is the exact failure the ISR note in
 * `lib/analytics-events.ts` describes, moved one layer down.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * ⚠️ THE FAIL-CLOSED ANSWER. 204, no body, nothing for a client to act on.
 *
 * Every way this subsystem can break — no env var, database down, credentials
 * rotated, pooler saturated — answers with this. The reasoning, measured in
 * `scripts/failclosed-probe.mjs` rather than assumed:
 *
 *   · A 4xx/5xx IS LOGGED BY THE BROWSER ITSELF, before any JavaScript sees it.
 *     `fetch(...).catch(() => {})` cannot suppress it. So an analytics backend
 *     that is merely DOWN paints red errors in the console of every reader who
 *     has devtools open — on a product whose whole pitch is that it is careful.
 *   · 5xx invites platform alerting and automatic retries. This subsystem must
 *     never be retried: a retry storm against a struggling database, to record
 *     that somebody looked at a poker room, is a bad trade at any volume.
 *   · There is nothing the client could DO with the failure. It has already
 *     moved on — most of these leave via `sendBeacon` during page unload.
 *
 * The failure goes to the SERVER LOG, which is read by somebody who can fix it.
 * Quiet for the reader is the goal; quiet for us is how a broken deploy runs
 * for a month, so every path here logs before it returns.
 */
const noContent = () => new NextResponse(null, { status: 204 })

/**
 * ⚠️ COUNTING MUST NEVER BREAK THE PRODUCT. Every failure below answers 2xx or
 * a quiet 4xx and writes nothing; none of them throws. A reader whose click was
 * not counted has lost nothing they can see, and an analytics endpoint that
 * returns 500 into a `fetch` with no catch is how a metric takes a page down.
 */
export async function POST(request: Request) {
  if (!analyticsConfigured()) {
    /* ⚠️ 204, NOT 503 — AND IT IS LOGGED. Measured, not assumed: this answered
       503 and logged NOTHING, which is both halves the wrong way round. A
       missing env var is invisible to whoever deployed it, while every reader
       with devtools open collects a red line the browser prints before our
       `.catch()` ever runs. See `noContent()` below. */
    console.error(
      '[analytics] CID_EVENTS_DATABASE_URL is not set — events are being dropped. '
      + 'The product is unaffected; nothing is being counted.',
    )
    return noContent()
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 })
  }

  const payload = body as { device_id?: unknown; session_id?: unknown; internal?: unknown; events?: unknown }
  const deviceId = typeof payload.device_id === 'string' ? payload.device_id : ''
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const events = Array.isArray(payload.events) ? payload.events : []

  /* The token shape the table's own CHECK constraints require. Rejected here
     too so a malformed caller gets a 400 rather than a constraint violation
     logged as a server error. */
  const token = (s: string) => s.length >= 8 && s.length <= 64
  if (!token(deviceId) || !token(sessionId)) {
    return NextResponse.json({ ok: false, reason: 'bad-identity' }, { status: 400 })
  }
  if (events.length === 0 || events.length > MAX_BATCH) {
    return NextResponse.json({ ok: false, reason: 'bad-batch' }, { status: 400 })
  }

  if (rateLimited(sessionId, events.length)) {
    /* 429 with nothing written. The client does not retry — a retrying client
       against a rate limit is a loop. */
    return NextResponse.json({ ok: false, reason: 'rate-limited' }, { status: 429 })
  }

  /* THE UA IS READ AND THROWN AWAY. One bit is kept, with the rules that
     decided it. Nothing here stores the string. */
  const bot = isBot(request.headers.get('user-agent'))

  /* ⚠️ `internal` IS TAKEN FROM THE CLIENT ON PURPOSE, and it is safe in one
     direction only. A caller can volunteer that they are us, which can only
     REMOVE their rows from a count; nothing here lets a caller claim they are
     NOT internal, because the flag defaults to false and is never cleared by a
     request. The failure mode is somebody excluding themselves, which is what
     the flag is for. */
  const isInternal = payload.internal === true

  /* Room slugs resolve to ids server-side. The client never sends a uuid —
     it has no legitimate way to know one, and accepting one would let a caller
     attach events to any row they could guess.

     ⚠️ THIS RUNS ON A DIFFERENT CONNECTION FROM THE WRITE, AND IT HAS TO.
     `supabase` here is the ANON PostgREST client over HTTPS (lib/supabase.ts),
     reading `public.rooms` — public data the whole site already reads as anon.
     It is NOT the `pg` pool in lib/analytics-server.ts.

     That separation is load-bearing rather than incidental. `cid_events_writer`
     holds USAGE on `public` and NO SELECT ON public.rooms — deliberately, so
     the writer can do exactly one thing. Move this lookup onto that connection
     as an "optimisation" to save an HTTP hop and it fails permission-denied;
     the catch would swallow it, every slug would resolve to undefined, and
     every room event would land with `room_id` null. THE ROWS WOULD STILL BE
     THERE AND THE TOTALS WOULD STILL BE RIGHT — only the per-room breakdown
     would be empty, so the console's Rooms tab would show nothing and nothing
     would look
     broken. `scripts/events-probe.mjs` asserts no room event has a null room
     precisely because that failure is silent everywhere else. */
  const slugs = [...new Set(
    events.map((e) => (e as ClientEvent).room_slug).filter((s): s is string => typeof s === 'string'),
  )]
  const roomIds = new Map<string, string>()
  if (slugs.length > 0) {
    const { data } = await supabase.from('rooms').select('id,slug').in('slug', slugs)
    for (const r of data ?? []) roomIds.set(r.slug as string, r.id as string)
  }

  const rows = []
  for (const raw of events) {
    const e = raw as ClientEvent
    /* An unknown name is DROPPED, not rejected. A client one deploy behind
       should not have its whole batch fail, and the enum in the database is the
       thing that actually decides what may exist. */
    if (!isEventName(e?.event_name)) continue
    const props = e.props && typeof e.props === 'object' && !Array.isArray(e.props) ? e.props : {}
    rows.push({
      event_name: e.event_name,
      device_id: deviceId,
      session_id: sessionId,
      room_id: e.room_slug ? roomIds.get(e.room_slug) ?? null : null,
      props,
      is_internal: isInternal,
      bot,
      bot_rules_version: BOT_RULES_VERSION,
      /* occurred_at is NOT set here — the column defaults to now() in the
         database, so the timestamp is the server's and a wrong client clock
         cannot rewrite it. */
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, written: 0, reason: 'no-known-events' })
  }

  /* ⚠️ NOT OVER REST, AND NOT AS THE SERVICE ROLE. This goes over a pooled
     Postgres connection as `cid_events_writer`, a role holding EXECUTE on one
     function and nothing else — see lib/analytics-server.ts and migration 017.
     PostgREST would refuse the analytics schema anyway (it is deliberately not
     exposed), and service_role has had EXECUTE on the function revoked, so
     there is no REST path to this table at all. */
  try {
    const written = await writeEvents(rows)
    return NextResponse.json({ ok: true, written })
  } catch (e) {
    /* ⚠️ LOGGED FOR US, 204 FOR THEM. This returned 500, which is the instinct
       and is wrong here: the database being unreachable is OUR problem, and a
       5xx makes it the reader's — a red line in their console, and on the
       platform side an alert and possible retries for a subsystem that must
       never be retried. The log is what carries the failure to someone who can
       act on it. */
    console.error('[analytics] write failed:', e instanceof Error ? e.message : String(e))
    return noContent()
  }
}

/** Nothing reads events over HTTP. Stated as a refusal rather than left to
 *  Next's 405, so the absence is a decision somebody can find. */
export function GET() {
  return NextResponse.json({ ok: false, reason: 'write-only' }, { status: 405 })
}
