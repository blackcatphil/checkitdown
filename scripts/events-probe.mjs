#!/usr/bin/env node
/**
 * EVERY EVENT PROVED RED BEFORE GREEN.
 *
 * ⚠️ THE FAILURE THIS EXISTS FOR: an event that fires on RENDER passes any test
 * that only asks "did we get a row". The number goes up, the dashboard fills
 * in, and it is counting builds. `/rooms/[slug]` is ISR with `revalidate = 300`
 * — one cached render is served to everybody who arrives in the next five
 * minutes — so "we got a row" is not evidence that anybody looked at anything.
 *
 * So every one of the six is asserted TWICE:
 *
 *   GREEN  perform the action            -> exactly one row
 *   RED    do the adjacent thing WITHOUT
 *          the trigger                   -> zero rows
 *
 * The red half is the one that matters. For `room_facts_view` it is a server
 * render with no browser at all; for `install_accept` it is a prompt the reader
 * DISMISSED, which is the difference between counting interest and counting
 * adoption.
 *
 *   BASE_URL=http://localhost:3000 node scripts/events-probe.mjs
 */
import { execFileSync } from 'node:child_process'

import { chromium } from 'playwright'

import { resolvePsql } from './psql-path.mjs'
import { localTarget } from './db-target.mjs'

const PSQL = resolvePsql()
const DB = localTarget('events-probe')
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'

/**
 * ⚠️ THIS SCRIPT CALLS `truncate analytics.events` BETWEEN EVERY SCENARIO, which
 * is correct for a probe and catastrophic anywhere else.
 *
 * The refusal that makes that safe now lives in `localTarget()` above — see
 * `scripts/db-target.mjs`. It used to be a hand-rolled check right here, and the
 * comment above it argued that `DATABASE_URL` holding PRODUCTION was survivable
 * because nothing loaded `.env.local`. That argument was wrong in the way that
 * matters: on 2026-08-12 a run reached production anyway, and the reason was the
 * NAME rather than the loading. `DATABASE_URL` is local now, production is
 * `PROD_DATABASE_URL`, and this file cannot reach it under any spelling.
 */

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

/* A REAL BROWSER'S UA. Headless Chromium's own string is flagged by the bot
   classifier — correctly, since a CI run must not look like traffic — and rows
   would still be written, just marked. The probe overrides it so the green
   assertions measure the path a person takes. */
const HUMAN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/* BOTH TABLES. `devices` accumulating across scenarios would make the
   first-sight assertion below pass on a row an earlier scenario wrote. */
const clear = () => sql('truncate analytics.events, analytics.devices')
const count = (name) => Number(sql(`select count(*) from analytics.events where event_name = '${name}'`))

/** One scenario: clear, act, count. */
async function scenario(browser, label, act) {
  clear()
  const ctx = await browser.newContext({ userAgent: HUMAN, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  try {
    await act(page, ctx)
  } catch (e) {
    console.log(`        (${label} threw: ${String(e).split('\n')[0]})`)
  }
  /* The client batches on a microtask and sends with sendBeacon; give the
     request time to land before counting. */
  await page.waitForTimeout(1200)
  await ctx.close()
}

const browser = await chromium.launch()
console.log('\nEVENT PROBE — every event red before green\n')

/* Preconditions. A probe that cannot see the table would report six cheerful
   zeroes on the red half and nothing on the green, and the zeroes would look
   like passes to a reader skimming. */
ok(sql("select to_regclass('analytics.events') is not null") === 't',
  'analytics.events exists (migration 017 applied locally)')
ok(sql('select count(*) from rooms') === '17', 'the roster is seeded')

/**
 * ⚠️ IS THE PAGE ALIVE? ASKED ONCE, BEFORE ANY EVENT IS COUNTED.
 *
 * On 2026-08-12 this suite failed 18 assertions at once and every one of them
 * was a symptom. `next dev` initialises on `localhost`, so `127.0.0.1` — the
 * host CI uses — is a DIFFERENT ORIGIN and Next 16 answers 403 to
 * `/_next/static/chunks/*` for it. The server HTML was complete: links present,
 * clickable, and clicks succeeded. Nothing mounted, so nothing fired.
 *
 * The shape of that failure is the reason for this check. Every GREEN half read
 * zero and every RED half PASSED — "counts NOTHING" is trivially true on a page
 * where nothing can happen — so the log looked like eighteen separate event
 * bugs rather than one dead page. A suite that cannot tell "the feature is
 * broken" from "the page never loaded" will send somebody to read
 * `lib/analytics.ts` for a day.
 *
 * ⚠️ SCOPED, so it cannot become permanently red for somebody else's noise.
 * Only failures on THIS origin count, and only `/_next/` — the app's own code.
 * A 404 from a room's website, or the dev server's unrelated chatter, is not
 * this probe's business. Same discipline as the fail-closed probe, which scopes
 * to `/api/events`.
 *
 * ⚠️ AND HYDRATION IS TESTED BY THE THING THE SUITE DEPENDS ON: whether React
 * attached a click handler. `window.next` exists on a page whose chunks all
 * 403'd — it was true throughout the outage — so it proves nothing. A DOM node
 * carrying `__reactProps$…` with an `onClick` proves the tree mounted AND that
 * handlers are live, which is precisely what every GREEN assertion needs.
 */
async function pageIsAlive(path, selector) {
  const ctx = await browser.newContext({ userAgent: HUMAN, viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const blocked = []
  const thrown = []
  page.on('pageerror', (e) => thrown.push(String(e).split('\n')[0]))
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE) && r.url().includes('/_next/')) {
      blocked.push(`${r.status()} ${r.url().slice(BASE.length)}`)
    }
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const wired = await page.locator(selector).first().evaluate((el) => {
    const k = Object.keys(el).find((x) => x.startsWith('__reactProps$'))
    return Boolean(k && typeof el[k].onClick === 'function')
  }).catch(() => false)
  await ctx.close()
  return { blocked, thrown, wired }
}

{
  const { blocked, thrown, wired } = await pageIsAlive('/rooms/aria', 'a:has-text("OWN PAGE")')
  if (blocked.length || thrown.length || !wired) {
    console.error('\n  ⚠️  THE PAGE IS BROKEN. NOT RUNNING THE EVENT ASSERTIONS.')
    console.error('      Every one of them would fail on the GREEN half and PASS on the RED,')
    console.error('      and the log would read as eighteen event bugs instead of one dead page.\n')
    if (blocked.length) {
      console.error(`      the app's own assets were refused (${blocked.length}):`)
      for (const b of blocked.slice(0, 4)) console.error(`        ${b}`)
      console.error(`\n      403 on /_next/ from ${BASE} is almost always allowedDevOrigins:`)
      console.error('      `next dev` initialises on localhost, so 127.0.0.1 and any LAN address')
      console.error('      are different origins and are refused. See next.config.ts.')
    }
    if (thrown.length) {
      console.error('      the page threw:')
      for (const t of thrown.slice(0, 3)) console.error(`        ${t}`)
    }
    if (!blocked.length && !thrown.length && !wired) {
      console.error('      React never attached a click handler — the tree did not mount.')
    }
    await browser.close()
    process.exit(2)
  }
  ok(true, 'the page under test mounted and its handlers are live — the events below can fire')
}

/* ── 0. THE WRITE PATH ITSELF ─────────────────────────────────────────────
   ⚠️ THE TRANSACTION POOLER FORBIDS PREPARED STATEMENTS, and the failure it
   causes is invisible locally: a prepared statement lives on one backend, the
   pooler hands the next query to another, and `prepared statement "s1" does not
   exist` arrives only under concurrency in production. The local Supavisor
   emulator cannot authenticate any role, so the pooler cannot be exercised
   here at all — but the property that matters can be, on any connection:
   after a write, the session must hold NO prepared statements. */
console.log('0. the write path')
clear()
await fetch(`${BASE}/api/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'user-agent': HUMAN },
  body: JSON.stringify({
    device_id: 'probe-device-aaaa', session_id: 'probe-session-aaaa',
    events: [{ event_name: 'room_facts_view', room_slug: 'aria' }],
  }),
})
await new Promise((r) => setTimeout(r, 500))
ok(count('room_facts_view') === 1, 'the endpoint writes through the dedicated role', `${count('room_facts_view')} row`)
ok(sql('select count(*) from pg_prepared_statements') === '0',
  'and prepares NOTHING — a named statement would break the moment the pooler moves the connection')
/* The app must not hold the service key at all. Asserted against the running
   process's own environment rather than against a file, because a stale
   .env.local would pass a grep and still be loaded. */
const envLeak = await fetch(`${BASE}/api/events`, { method: 'GET' }).then((r) => r.status)
ok(envLeak === 405, 'and the endpoint is write-only', `GET -> ${envLeak}`)
clear()

/* ── 1. room_facts_view ──────────────────────────────────────────────────
   RED IS A SERVER RENDER. This is the ISR trap in its purest form: fetch the
   HTML the way a cache would, with no JavaScript, and nothing may be counted. */
console.log('\n1. room_facts_view')
clear()
await fetch(`${BASE}/rooms/aria`).then((r) => r.text())
await new Promise((r) => setTimeout(r, 800))
ok(count('room_facts_view') === 0,
  'RED  a server render of the room page counts NOTHING — a cached render is not a view',
  `${count('room_facts_view')} rows from a no-JavaScript fetch`)

await scenario(browser, 'room view', async (page) => {
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
})
ok(count('room_facts_view') === 1,
  'GREEN a browser opening the room page counts exactly one', `${count('room_facts_view')} row(s)`)

/* ── 2. map_filter_apply ───────────────────────────────────────────────── */
console.log('\n2. map_filter_apply')
await scenario(browser, 'map idle', async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  /* The map boots, the camera settles, filters are rendered — and untouched. */
  await page.waitForTimeout(3000)
})
ok(count('map_filter_apply') === 0,
  'RED  loading the map and touching nothing counts NOTHING', `${count('map_filter_apply')} rows`)

await scenario(browser, 'map filter', async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const box = page.locator('.cid-check').first()
  await box.waitFor({ timeout: 15000 })
  await box.click()
  await page.waitForTimeout(600)
})
ok(count('map_filter_apply') === 1,
  'GREEN applying one filter counts exactly one', `${count('map_filter_apply')} row(s)`)

/* ── 3. tournament_row_open ────────────────────────────────────────────── */
console.log('\n3. tournament_row_open')
await scenario(browser, 'tournaments idle', async (page) => {
  await page.goto(`${BASE}/tournaments`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
})
ok(count('tournament_row_open') === 0,
  'RED  listing tournaments counts NOTHING — a row rendered is not a row opened',
  `${count('tournament_row_open')} rows`)

await scenario(browser, 'tournament open', async (page) => {
  await page.goto(`${BASE}/tournaments`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.locator('.cid-tt-row a[href^="/rooms/"]').first().click()
  await page.waitForTimeout(600)
})
ok(count('tournament_row_open') === 1,
  'GREEN opening one row counts exactly one', `${count('tournament_row_open')} row(s)`)

/* ── 4. outbound_room_click ────────────────────────────────────────────── */
console.log('\n4. outbound_room_click')
await scenario(browser, 'room page, no click', async (page) => {
  await page.goto(`${BASE}/rooms/wynn-encore`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
})
ok(count('outbound_room_click') === 0,
  'RED  a page CARRYING outbound links, none clicked, counts NOTHING',
  `${count('outbound_room_click')} rows`)

await scenario(browser, 'outbound click', async (page, ctx) => {
  await page.goto(`${BASE}/rooms/wynn-encore`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  /* The link opens a PDF on the room's own CDN. The navigation is not the
     point and must not be waited on — the event is fired by the click and
     carried out by sendBeacon, which is exactly the case that survives the
     page going away. */
  await ctx.route('**/*.pdf', (route) => route.abort())
  await page.locator('a:has-text("FULL STRUCTURE")').first().click({ noWaitAfter: true })
  await page.waitForTimeout(800)
})
ok(count('outbound_room_click') === 1,
  'GREEN leaving for the room\'s own document counts exactly one', `${count('outbound_room_click')} row(s)`)

/* ── 4b. THE NEW OUTBOUND PRODUCERS ────────────────────────────────────────
   Four doors that did not exist before this round: the room's own site,
   directions built from its coordinates, the phone as a dialable number, and
   the structure PDF on /tournaments. Each is red on a page load and green on a
   click. `menu` has no producer to test — `menu_url` is 0/17, so the renderer
   is there and nothing renders; that is stated in the report rather than
   asserted here against data that does not exist. */
console.log('\n4b. the doors that did not exist until this round')
for (const [kind, sel, path] of [
  /* Matched on a substring without the apostrophe: the page renders
     &rsquo; and a straight quote in the selector matches nothing. */
  ['website', 'a:has-text("OWN PAGE")', '/rooms/aria'],
  ['directions', 'a:has-text("DIRECTIONS")', '/rooms/aria'],
  ['phone', 'a:has-text("CALL")', '/rooms/aria'],
  ['structure_pdf', '.cid-tt-pdf', '/tournaments'],
]) {
  await scenario(browser, `${kind} idle`, async (page) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
  })
  const red = count('outbound_room_click')
  await scenario(browser, `${kind} click`, async (page, ctx) => {
    await ctx.route('**/*.pdf', (r) => r.abort())
    await ctx.route('https://www.google.com/**', (r) => r.abort())
    await ctx.route('https://**', (r) => r.abort())
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await page.locator(sel).first().click({ noWaitAfter: true })
    await page.waitForTimeout(800)
  })
  const green = count('outbound_room_click')
  ok(red === 0 && green === 1, `${kind}: RED page load ${red} · GREEN click ${green}`)
}

/* ── 4c. source_link_click — the receipt, which is NOT outbound demand ──── */
console.log('\n4c. source_link_click')
await scenario(browser, 'receipt idle', async (page) => {
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
})
ok(count('source_link_click') === 0, 'RED  a page carrying receipts, none clicked, counts NOTHING')

await scenario(browser, 'receipt click', async (page, ctx) => {
  await ctx.route('https://**', (r) => r.abort())
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.locator('a[rel~="nofollow"]').first().click({ noWaitAfter: true })
  await page.waitForTimeout(800)
})
ok(count('source_link_click') === 1, 'GREEN opening a receipt counts exactly one')
/* ⚠️ THE ASSERTION THE SPLIT EXISTS FOR. Outbound demand is the number a room
   would be right to challenge; a receipt click must not land in it. */
ok(count('outbound_room_click') === 0,
  'and it does NOT land in outbound_room_click — checking our work is not demand',
  `${count('outbound_room_click')} outbound rows`)
ok(sql("select props->>'host_is_room' from analytics.events where event_name='source_link_click'") !== '',
  'with host_is_room in the props',
  sql("select props->>'host_is_room' from analytics.events where event_name='source_link_click'"))

/* ── 5. fact_report_submit ─────────────────────────────────────────────── */
console.log('\n5. fact_report_submit')
await scenario(browser, 'form opened, not sent', async (page) => {
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const opener = page.locator('button:has-text("REPORT")').first()
  if (await opener.count()) await opener.click()
  await page.waitForTimeout(300)
  const field = page.locator('textarea').first()
  if (await field.count()) await field.fill('typed but never submitted')
  await page.waitForTimeout(500)
})
ok(count('fact_report_submit') === 0,
  'RED  opening the form and typing, without submitting, counts NOTHING',
  `${count('fact_report_submit')} rows`)

await scenario(browser, 'report submitted', async (page) => {
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const opener = page.locator('button:has-text("REPORT")').first()
  if (await opener.count()) await opener.click()
  await page.waitForTimeout(300)
  await page.locator('textarea').first().fill('events probe — synthetic correction')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(1500)
})
ok(count('fact_report_submit') === 1,
  'GREEN a submitted correction counts exactly one, AFTER the insert succeeds',
  `${count('fact_report_submit')} row(s)`)
/* The probe wrote a real correction; take it back out. */
sql("delete from corrections where message = 'events probe — synthetic correction'")

/* ── 6. install_accept ─────────────────────────────────────────────────── */
console.log('\n6. install_accept')
const installRun = async (outcome) => {
  await scenario(browser, `install ${outcome}`, async (page) => {
    await page.goto(`${BASE}/install?platform=android`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.evaluate((o) => {
      const e = new Event('beforeinstallprompt')
      e.prompt = async () => {}
      e.userChoice = Promise.resolve({ outcome: o, platform: 'web' })
      window.dispatchEvent(e)
    }, outcome)
    await page.waitForTimeout(400)
    await page.locator('.cid-install-btn').click()
    await page.waitForTimeout(800)
  })
}
/* ⚠️ THE STRONGEST RED IN THIS FILE. The button was pressed and the dialog
   opened — the only difference is what the reader chose. An implementation that
   counted the CLICK would pass every "did we get a row" test and report
   installs that never happened. */
await installRun('dismissed')
ok(count('install_accept') === 0,
  'RED  a prompt the reader DISMISSED counts NOTHING — the button was still pressed',
  `${count('install_accept')} rows`)

await installRun('accepted')
ok(count('install_accept') === 1,
  'GREEN an accepted prompt counts exactly one', `${count('install_accept')} row(s)`)

/* ── The shape of what was written ─────────────────────────────────────── */
console.log('\n7. what the rows actually contain')
await scenario(browser, 'shape', async (page) => {
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
})
/* Booleans concatenated into text render as `true`/`false`, not the `t`/`f`
   psql prints for a bare boolean column — the first version compared against
   't' and reported four failures on rows that were entirely correct. */
const row = sql(`select event_name || '|' || (room_id is not null) || '|' || bot || '|'
  || bot_rules_version || '|' || (device_id is not null) || '|' || (session_id is not null)
  || '|' || is_internal from analytics.events limit 1`).split('|')
ok(row[1] === 'true', 'the room was resolved server-side from its slug — the client never sent a uuid', row[1])
ok(row[2] === 'false', 'a real browser UA is not flagged as a bot', `bot=${row[2]}`)
ok(row[3] !== '', 'the classifier version is stored with the answer', row[3])
ok(row[4] === 'true' && row[5] === 'true', 'both tokens are present', `${row[4]}/${row[5]}`)
ok(row[6] === 'false', 'and the row is not marked internal by default', row[6])

/* NO IP, NO USER-AGENT — asserted against the live schema rather than the
   migration text, because the column that matters is the one that exists. */
const cols = sql(`select string_agg(column_name, ',' order by column_name)
  from information_schema.columns where table_schema='analytics' and table_name='events'`)
ok(!/\bip\b|ip_address|user_agent|useragent|referrer/.test(cols),
  'the table holds no IP, no raw user-agent and no referrer', cols)

/* ⚠️ THE DEVICE IS RECORDED THROUGH THE APP, NOT JUST THROUGH THE FUNCTION.
   `analytics.devices` is what makes "new reach" mean "no prior event EVER"
   rather than "none in 90 days" — see migration 017. The scratch gate proves
   the SQL keeps first_seen_at still; this proves the running product actually
   creates the row, which is a different claim and the one that breaks if the
   handler ever stops passing device_id through. */
ok(Number(sql('select count(*) from analytics.devices')) === 1,
  'the reader\'s device was recorded in analytics.devices — on first sight, through the same door',
  `${sql('select count(*) from analytics.devices')} device row(s)`)

/* ── 8. A ROOM EVENT WITH NO ROOM IS A FAILURE, NOT A NULL ──────────────────
   ⚠️ THE FAILURE THIS CATCHES IS SILENT EVERYWHERE ELSE.

   `room_id` is nullable, and correctly so — most events are not about a room.
   But for these three names the room is the entire content of the event, and a
   null there means the slug→uuid resolution did not happen.

   If that resolution breaks, NOTHING ELSE NOTICES. The rows still arrive. The
   totals are still right. Every red/green assertion above still passes, because
   each one counts rows by name and never looks at the room. The only visible
   symptom is the ledger's per-room breakdown being empty — which reads as "no
   traffic yet", not as "the join is broken".

   The concrete way it breaks: the resolution runs on the ANON PostgREST client,
   not the `cid_events_writer` pool, and `cid_events_writer` has no SELECT on
   public.rooms. Moving the lookup onto the pool to save an HTTP hop — a
   plausible tidy-up — makes every one of these rows null. See the note in
   app/api/events/route.ts.

   All three names in ONE scenario, so the assertion sees them together rather
   than being satisfied by whichever happened to run last. */
console.log('\n8. every room-scoped event carries its room')
await scenario(browser, 'all three room events', async (page, ctx) => {
  await ctx.route('https://**', (r) => r.abort())
  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)                                   // room_facts_view
  await page.locator('a:has-text("OWN PAGE")').first().click({ noWaitAfter: true })
  await page.waitForTimeout(400)                                   // outbound_room_click
  await page.locator('a[rel~="nofollow"]').first().click({ noWaitAfter: true })
  await page.waitForTimeout(800)                                   // source_link_click
})
const ROOM_SCOPED = "('room_facts_view','outbound_room_click','source_link_click')"
const orphans = Number(sql(
  `select count(*) from analytics.events
   where event_name in ${ROOM_SCOPED} and room_id is null`))
/* THE POSITIVE CONTROL. `0 orphans` is also what an empty table says, so the
   assertion above is worthless without proof the rows were actually there. */
const scoped = Number(sql(
  `select count(*) from analytics.events where event_name in ${ROOM_SCOPED}`))
ok(scoped >= 3, 'all three room-scoped events were produced — without this, zero orphans proves nothing',
  `${scoped} rows across ${sql(`select count(distinct event_name) from analytics.events where event_name in ${ROOM_SCOPED}`)} names`)
ok(orphans === 0,
  'and NONE of them has a null room — a room event with no room is a failure, not a null',
  `${orphans} orphaned of ${scoped}`)

clear()
await browser.close()
console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
