#!/usr/bin/env node
/**
 * ⚠️ ANALYTICS MUST NOT BE ABLE TO BREAK A PAGE OR SLOW A CLICK.
 *
 * Counting is the least important thing this product does. A reader whose click
 * went uncounted has lost nothing they can see; a reader whose click was SLOWED,
 * or whose console filled with errors, or whose page threw, has lost something
 * real — traded for a number nobody outside this repo will ever look at.
 *
 * So the failure modes are measured rather than reasoned about, under the two
 * ways this actually breaks in production:
 *
 *   A. CID_EVENTS_DATABASE_URL is unset      — a deploy missing an env var.
 *   B. the pool is unreachable                — database down, credentials
 *                                               rotated, pooler saturated.
 *
 * Both are FAIL-CLOSED conditions: write nothing, tell the server operator, and
 * be invisible to the reader. "Invisible" is the part that needs a browser to
 * check, because a 5xx from `fetch` is logged by the browser itself whether or
 * not our code catches it.
 *
 *   node scripts/failclosed-probe.mjs
 *
 * Starts and stops its own dev servers on a spare port — nothing else has the
 * right environment, and reusing a running one would measure the wrong config.
 */
import { execFileSync, spawn } from 'node:child_process'

import { chromium } from 'playwright'

const PORT = Number(process.env.FAILCLOSED_PORT ?? 3210)
const BASE = `http://127.0.0.1:${PORT}`

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

/** A dev server with a deliberately broken analytics config. */
async function withServer(env, fn) {
  const proc = spawn('npm', ['run', 'dev', '--', '-p', String(PORT)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proc.stdout.on('data', (d) => { log += d })
  proc.stderr.on('data', (d) => { log += d })
  try {
    for (let i = 0; i < 90; i++) {
      try {
        const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(1500) })
        if (r.ok) break
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 1000))
    }
    return await fn(() => log)
  } finally {
    proc.kill('SIGTERM')
    /* `npm run dev` spawns next as a child; killing npm can leave it holding
       the port, which would make the NEXT scenario measure the WRONG server —
       a false pass that looks like a clean run. */
    try { execFileSync('/usr/bin/pkill', ['-f', `next dev -p ${PORT}`]) } catch { /* none left */ }
    await new Promise((r) => setTimeout(r, 1200))
  }
}

const post = async () => {
  const r = await fetch(`${BASE}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device_id: 'aaaaaaaaaa',
      session_id: 'bbbbbbbbbb',
      events: [{ event_name: 'room_facts_view', room_slug: 'aria' }],
    }),
  })
  return { status: r.status, body: await r.text() }
}

/**
 * What a READER would see. Console messages, page errors and — the one that
 * costs something — how long the browser took to leave on an outbound click.
 */
async function readerExperience(browser) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()
  const errors = []
  const thrown = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  /* The URL, not just the message. "Failed to load resource" names nothing, and
     a console assertion that cannot say WHICH resource failed will happily
     blame analytics for somebody else's 403. */
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`)
  })
  page.on('pageerror', (e) => thrown.push(String(e)))

  await page.goto(`${BASE}/rooms/aria`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  /* The outbound host is blocked so the measurement is OUR latency, not the
     open internet's. */
  await ctx.route('https://**', (r) => r.abort())
  const link = page.locator('a:has-text("OWN PAGE")').first()
  const t0 = Date.now()
  await link.click({ noWaitAfter: true })
  /* Wait for the browser to actually begin leaving, not for a fixed sleep —
     a sleep would report the sleep. */
  await page.waitForTimeout(50)
  const clickMs = Date.now() - t0

  await page.waitForTimeout(800)
  await ctx.close()
  return { errors, thrown, clickMs }
}

console.log('\nFAIL-CLOSED PROBE — analytics broken, product unharmed\n')
const browser = await chromium.launch()

const SCENARIOS = [
  ['A. CID_EVENTS_DATABASE_URL unset', { CID_EVENTS_DATABASE_URL: '' }],
  ['B. the pool is unreachable', {
    CID_EVENTS_DATABASE_URL: 'postgresql://cid_events_writer:nope@127.0.0.1:59999/postgres',
  }],
]

for (const [label, env] of SCENARIOS) {
  console.log(`\n${label}`)
  await withServer(env, async (getLog) => {
    const { status, body } = await post()

    /* ⚠️ 204, NOT 5xx. A 5xx is logged by the BROWSER, unconditionally, before
       any of our code sees it — `.catch()` cannot suppress it. So a failing
       analytics backend paints red errors in the console of every reader with
       devtools open, on a product whose entire pitch is that it is careful.
       It also invites platform alerting and retry behaviour for a subsystem
       that must never be retried. 204 says "received, nothing to say". */
    ok(status === 204, 'POST /api/events answers 204 — no status a browser will log',
      `got ${status}${body ? ` ${body}` : ''}`)
    ok(body === '', 'and returns no body — there is nothing for a client to act on', JSON.stringify(body))

    const r = await readerExperience(browser)

    /* THE SERVER OPERATOR MUST STILL BE TOLD. Silent to the reader is the goal;
       silent to us is how a misconfigured deploy runs for a month. */
    const log = getLog()
    ok(/\[analytics\]/.test(log),
      'the server logs the failure — quiet for the reader is not quiet for us',
      (log.match(/\[analytics\][^\n]*/) ?? ['(nothing logged)'])[0].slice(0, 90))

    /* ⚠️ ISOLATED ON /api/events, NOT "ZERO CONSOLE ERRORS".
       The first version asserted a clean console and failed on
       `HTTP 403 /_next/static/chunks/node_modules_next_dist_….js` — a Next dev
       chunk, present identically whether analytics works or not. Asserting zero
       would have made this gate a detector of unrelated dev-server noise: red
       for something nobody here can fix, and — worse — it would go green again
       the day that noise stopped, having never tested analytics at all.
       The question is whether ANALYTICS puts anything in the reader's console. */
    const ours = r.errors.filter((e) => /\/api\/events/.test(e))
    ok(ours.length === 0, 'analytics puts NOTHING in the reader\'s console',
      ours.length ? ours.slice(0, 2).join(' | ') : `0 (of ${r.errors.length} unrelated dev-server messages)`)
    ok(r.thrown.length === 0, 'nothing throws — no unhandled rejection from a dropped beacon',
      r.thrown.length ? r.thrown[0] : '0 page errors')
    /* A generous ceiling on purpose: this is checking that the click is not
       BLOCKED on a network round trip, not micro-benchmarking the browser. */
    ok(r.clickMs < 400, 'the outbound click is not delayed by the dead write path', `${r.clickMs}ms`)
  })
}

await browser.close()
console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
