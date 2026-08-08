#!/usr/bin/env node
/**
 * THE SERVICE WORKER MUST NOT CACHE FACTS.
 *
 * `public/sw.js` argues the case in comments. Comments do not survive the next
 * person who wants offline support, so the ruling is asserted here instead:
 *
 *   1. the manifest is served and valid, with token-derived colours
 *   2. a DATA response is not served from cache while the network is up
 *   3. offline renders the honest offline state, NOT a cached page
 *   4. no page HTML is in the cache at all — the strongest form of 2 and 3,
 *      because a page that was never stored cannot be served stale
 *
 * Assertion 4 is the one that matters most. 2 and 3 test behaviour; 4 tests
 * that the dangerous thing does not exist. A cache miss today and a cache hit
 * after someone adds one line are indistinguishable to 2 and 3 if the
 * conditions happen to line up.
 *
 *   node scripts/pwa-probe.mjs [url]
 */
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3100'

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

/* ── 1. The manifest ─────────────────────────────────────────────────────── */
const mres = await page.request.get(`${BASE}/manifest.webmanifest`)
const manifest = mres.ok() ? await mres.json() : null
console.log('\nPWA PROBE\n')
ok(mres.ok(), `manifest is served (${mres.status()})`)
ok(manifest?.display === 'standalone', 'display is standalone', manifest?.display)
ok(Boolean(manifest?.start_url), 'start_url is set', manifest?.start_url)
ok(/^#[0-9A-Fa-f]{6}$/.test(manifest?.theme_color ?? ''), 'theme_color is a real colour', manifest?.theme_color)
ok(manifest?.theme_color === manifest?.background_color
  || /^#[0-9A-Fa-f]{6}$/.test(manifest?.background_color ?? ''),
'background_color is a real colour', manifest?.background_color)

const sizes = (manifest?.icons ?? []).map((i) => i.sizes)
ok(sizes.includes('192x192') && sizes.includes('512x512'),
  'the two sizes Android requires are present', sizes.join(' '))
ok((manifest?.icons ?? []).some((i) => i.purpose === 'maskable'),
  'a maskable icon exists for Android launcher cropping')
/* Every icon must actually resolve — a manifest listing a 404 installs happily
   and shows a blank square. */
for (const icon of manifest?.icons ?? []) {
  const r = await page.request.get(`${BASE}${icon.src}`)
  ok(r.ok(), `icon resolves: ${icon.src}`, String(r.status()))
}
const apple = await page.request.get(`${BASE}/apple-touch-icon.png`)
ok(apple.ok(), 'apple-touch-icon resolves (iOS ignores the manifest for this)')

/* iOS reads meta tags, not the manifest, for standalone mode and the title. */
await page.goto(BASE, { waitUntil: 'load' })
const meta = await page.evaluate(() => ({
  viewport: document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '',
  capable: document.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute('content') ?? '',
  title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') ?? '',
  theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
  touch: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? '',
}))
ok(/width=device-width/.test(meta.viewport), 'viewport meta exists', meta.viewport)
ok(meta.capable === 'yes', 'iOS standalone capability is declared')
ok(meta.title.length > 0, 'iOS home-screen title is set', meta.title)
ok(meta.touch.length > 0, 'apple-touch-icon is linked')
ok(meta.theme === manifest?.theme_color,
  'the meta theme-color and the manifest agree', `${meta.theme} vs ${manifest?.theme_color}`)

/* ── 2/3/4. The cache ────────────────────────────────────────────────────── */
await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 })
  .catch(() => {})
const controlled = await page.evaluate(() => navigator.serviceWorker?.controller != null)
ok(controlled, 'the service worker is registered and controlling the page')

/* Visit a data-bearing page so that, if the worker were going to cache one, it
   would have. Wynn carries rake figures — exactly the class of fact that must
   never be served from disk. */
await page.goto(`${BASE}/rooms/wynn-encore`, { waitUntil: 'load' })
await page.waitForTimeout(1500)

const cacheState = await page.evaluate(async () => {
  const names = await caches.keys()
  const urls = []
  for (const n of names) {
    const c = await caches.open(n)
    for (const req of await c.keys()) urls.push(req.url)
  }
  return { names, urls }
})
const pathsOf = (u) => new URL(u).pathname
const cachedPaths = cacheState.urls.map(pathsOf)

/* THE ASSERTION THAT MATTERS: no page HTML in the cache. Not the room page,
   not /facts, not the map. */
const pageLike = cachedPaths.filter((p) =>
  p === '/' || p.startsWith('/rooms/') || p === '/facts' || p === '/tournaments' || p === '/promos')
ok(pageLike.length === 0,
  'NO page HTML is in the cache — a page never stored cannot be served stale',
  pageLike.join(', ') || 'cache holds only shell assets')

const shellOnly = cachedPaths.every((p) =>
  p.startsWith('/_next/static/') || p === '/offline' || p === '/manifest.webmanifest'
  || /\.(png|svg|ico|woff2?)$/.test(p))
ok(shellOnly, 'everything cached is a shell asset', cachedPaths.filter((p) =>
  !(p.startsWith('/_next/static/') || p === '/offline' || p === '/manifest.webmanifest'
    || /\.(png|svg|ico|woff2?)$/.test(p))).join(', ') || `${cachedPaths.length} entries, all shell`)

/* 2. WITH THE NETWORK UP, THE DATA COMES FROM THE NETWORK.
   The first version asserted `fromServiceWorker === false` and failed, because
   that flag is TRUE for a worker that fetched the network and passed the
   response through — which is exactly what this worker does. The flag says
   "the worker answered", not "the worker answered from disk", so it cannot
   tell the safe case from the dangerous one. A control that cannot distinguish
   the two outcomes is not a control.
   What discriminates: ask the cache directly whether it holds this URL. A
   response cannot come from an empty cache, so "the worker answered" plus "the
   cache has no entry for it" means the bytes came off the network. */
let servedByWorker = null
page.on('response', (res) => {
  if (new URL(res.url()).pathname === '/rooms/orleans') servedByWorker = res.fromServiceWorker()
})
await page.goto(`${BASE}/rooms/orleans`, { waitUntil: 'load' })
await page.waitForTimeout(600)
const hasFigure = await page.evaluate(() => /CASH GAMES/.test(document.body.textContent ?? ''))
const cachedThisPage = await page.evaluate(async () => {
  const hit = await caches.match(new Request(location.href))
  return hit != null
})
ok(cachedThisPage === false,
  'the cache holds no entry for the page just loaded, so it came off the network',
  `worker handled it: ${servedByWorker}; cache entry: ${cachedThisPage}`)
ok(hasFigure, 'and it renders its figures')

/* 3. OFFLINE renders the honest state, and no figures. */
await ctx.setOffline(true)
await page.goto(`${BASE}/rooms/orleans`, { waitUntil: 'load' }).catch(() => {})
const offline = await page.evaluate(() => document.body.textContent ?? '')
ok(/can.{0,3}t reach the data/i.test(offline),
  'offline renders the honest offline state')
ok(!/CASH GAMES/.test(offline) && !/\$\d+\/\d+/.test(offline),
  'and shows NO figures — not yesterday\'s rake wearing today\'s date')
await ctx.setOffline(false)

await browser.close()
console.log('')
process.exit(failed ? 1 : 0)
