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

import { INSTALL_URL } from '../lib/install.ts'
import { decodeMatrix, matrixFromLuma } from '../lib/qr-decode.ts'
import { readServerToken } from '../lib/tokens-server.ts'

/* The same two tokens `scripts/make-icons.py` draws the mark from, read the
   same way the manifest reads its colours — so this cannot pass against an icon
   drawn from a palette the app has since left behind. */
const readTokenRgb = (hex) => {
  const h = hex.trim().replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}
const manifestBlue = readServerToken('--cid-accent-500')
const manifestGold = readServerToken('--cid-gold-500')

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3100'

let failed = 0
let skipped = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}
/**
 * A SKIPPED ASSERTION MUST BE LOUDER THAN A PASSING ONE.
 *
 * The alternative — running the cache assertions anyway when no worker is
 * registered — is worse than skipping and worse than failing. They all PASS
 * vacuously: "no page HTML is in the cache" is trivially true of an EMPTY
 * cache, and "everything cached is a shell asset" is true of nothing. Measured,
 * with `sw.js` removed: three green lines that had checked nothing at all.
 * That is a suite quietly shrinking, which is the exact thing the CI floors
 * exist to catch, so the count is printed and the reason is named.
 */
const skip = (msg, why) => { console.log(`  SKIP  ${msg} — ${why}`); skipped++ }

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

/**
 * ⚠️ THE TAB ICON IS OURS, AND THIS IS NOT A HYPOTHETICAL CHECK.
 *
 * `app/favicon.ico` was the NEXT.JS DEFAULT — a black disc with a white
 * triangle, Vercel's mark — and it had been the identity in every browser tab
 * on checkitdown.com since launch. Nothing caught it: the file existed, the
 * route returned 200, the manifest icons were all correct and all ours, and
 * `<link rel="icon">` pointed at a real image. Every structural check passes on
 * a framework's logo.
 *
 * So the assertion is about the PIXELS: our mark is a blue disc with a gold
 * rim, both read from the same tokens the manifest uses, and an icon that is
 * black-and-white contains neither. Sampled from the rendered image rather than
 * compared to a stored hash, because a hash pins the file we happen to ship and
 * says nothing about whether it is the right artwork.
 */
const iconPalette = await page.evaluate(async (tokens) => {
  /* ⚠️ THE HREF THE BROWSER IS ACTUALLY GIVEN, not a guessed path. Next serves
     app/icon.png from a hashed route and emits the <link> itself, so probing
     '/icon.png' would test a URL no browser is told to use — and would have
     kept passing after a rename. */
  const link = document.querySelector('link[rel="icon"][href], link[rel="shortcut icon"][href]')
  if (!link) return { error: 'no <link rel="icon"> in the document at all' }
  const href = link.getAttribute('href')
  const load = (src) => new Promise((res) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => res(null)
    i.src = src
  })
  const img = await load(href)
  if (!img) return { error: `the declared icon did not load: ${href}` }
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const cx = c.getContext('2d')
  cx.drawImage(img, 0, 0)
  const { data } = cx.getImageData(0, 0, c.width, c.height)
  const near = (r, g, b, t, tol) => Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol
  let blue = 0, gold = 0, total = 0
  for (let i = 0; i < data.length; i += 4) {
    total++
    if (near(data[i], data[i + 1], data[i + 2], tokens.blue, 40)) blue++
    if (near(data[i], data[i + 1], data[i + 2], tokens.gold, 40)) gold++
  }
  return { href, size: `${c.width}x${c.height}`, bluePct: Math.round((blue / total) * 100), goldPct: Math.round((gold / total) * 100) }
}, {
  blue: [...(readTokenRgb(manifestBlue))],
  gold: [...(readTokenRgb(manifestGold))],
})
if (iconPalette.error) {
  ok(false, 'the tab icon is our mark', iconPalette.error)
} else {
  ok(iconPalette.bluePct >= 15,
    'the tab icon is OUR mark, not the framework default — it is mostly the brand blue',
    `${iconPalette.href} ${iconPalette.size}, ${iconPalette.bluePct}% brand blue`)
  ok(iconPalette.goldPct >= 2,
    'and it carries the gold rim, which no default icon has',
    `${iconPalette.goldPct}% gold`)
}

/**
 * ⚠️ THE SHARE CARD, IN PIXELS — same pattern as the tab icon above, and this
 * gate has quietly become the identity gate as well as the installability one.
 * That is deliberate: both are generated brand artefacts served as images, and
 * both fail in the way a status code cannot see.
 *
 * There was NO OpenGraph anything before 2026-08-11 — no metadata, no image,
 * nothing in the head — so every share of this site rendered as a bare URL.
 * A route that 200s with a blank canvas would restore exactly that outcome
 * while looking fixed, so the assertion is that the brand is actually ON it.
 */
const og = await page.evaluate(async (tokens) => {
  /* The URL the CRAWLER is given, read from the document rather than guessed —
     Next serves the image from a hashed route and a hardcoded path would test a
     URL nothing points at. */
  const meta = document.querySelector('meta[property="og:image"]')
  if (!meta) return { error: 'no <meta property="og:image"> in the document' }
  const href = meta.getAttribute('content')
  const img = await new Promise((res) => {
    const i = new Image()
    i.onload = () => res(i); i.onerror = () => res(null)
    i.src = href
  })
  if (!img) return { error: `the declared og:image did not load: ${href}` }
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const cx = c.getContext('2d')
  cx.drawImage(img, 0, 0)
  const { data } = cx.getImageData(0, 0, c.width, c.height)
  const near = (i, t, tol) => Math.abs(data[i] - t[0]) <= tol
    && Math.abs(data[i + 1] - t[1]) <= tol && Math.abs(data[i + 2] - t[2]) <= tol
  let blue = 0, gold = 0, ink = 0, total = 0
  for (let i = 0; i < data.length; i += 4) {
    total++
    if (near(i, tokens.blue, 40)) blue++
    if (near(i, tokens.gold, 55)) gold++
    if (near(i, tokens.ink, 12)) ink++
  }
  const pc = (n) => Math.round((n / total) * 1000) / 10
  return {
    href, w: c.width, h: c.height,
    bluePct: pc(blue), goldPct: pc(gold), inkPct: pc(ink),
    twitter: document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? null,
    card: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? null,
  }
}, { blue: readTokenRgb(manifestBlue), gold: readTokenRgb(manifestGold), ink: readTokenRgb(readServerToken('--cid-ink-800')) })

if (og.error) {
  ok(false, 'the share card renders', og.error)
} else {
  /* 1200x630 is what every platform crops from. A card at any other ratio gets
     cut, and the crop is never where you would have chosen. */
  ok(og.w === 1200 && og.h === 630,
    'the share card is 1200x630 — the size every platform crops from', `${og.w}x${og.h}`)
  ok(og.inkPct > 50,
    'it is drawn on the app\'s own ink, not a default white canvas', `${og.inkPct}% ink`)
  ok(og.bluePct >= 0.5,
    'the brand blue is actually in the pixels — the mark is on the card', `${og.bluePct}%`)
  ok(og.goldPct >= 0.3,
    'and so is the gold, which is the hairline and the trust line', `${og.goldPct}%`)
  /* THE TWITTER IMAGE COMES FREE from the same file — asserted rather than
     assumed, because if Next ever stops emitting it, X falls back to no image
     at all and nothing else here would notice. */
  ok(og.twitter === og.href && og.card === 'summary_large_image',
    'X gets the same card, at large-image size, without a second file',
    `${og.card} · ${og.twitter === og.href ? 'same image' : og.twitter}`)
}

const icoRes = await page.request.get(`${BASE}/favicon.ico`)
ok(icoRes.ok() && Number(icoRes.headers()['content-length'] ?? 1) > 0,
  '/favicon.ico is served — still requested unconditionally by unfurlers and feed readers',
  `${icoRes.status()} ${icoRes.headers()['content-type'] ?? ''}`)


/* ── 2/3/4. The cache ──────────────────────────────────────────────────────
   EVERYTHING BELOW HAS ONE PRECONDITION: a registered, controlling service
   worker. Without it there is no cache policy to test, so the honest outcome
   is a named skip rather than a crash or a row of hollow passes.
   MEASURED 2026-08-07 — the worker registers under a plain `next dev`, from
   cold, with no warm-up: 23/23 on a server whose only prior request was `/`.
   So this is not a dev-versus-production skip. It fires when the worker is
   genuinely unavailable — `sw.js` missing or 404, an unsupported browser, or a
   server serving a build made before the file existed. Reproduced by removing
   `public/sw.js`: the old version FAILED the registration check, then passed
   three cache assertions against an empty cache, then threw on the offline
   navigation. */
await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20000 })
  .catch(() => {})
const controlled = await page.evaluate(() => navigator.serviceWorker?.controller != null)

if (!controlled) {
  const swRes = await page.request.get(`${BASE}/sw.js`).catch(() => null)
  const why = swRes && swRes.ok()
    ? 'no controlling worker (sw.js is served, so the browser refused or was still installing)'
    : `sw.js is not being served (${swRes ? swRes.status() : 'request failed'})`
  console.log('')
  skip('the service worker is registered and controlling the page', why)
  skip('NO page HTML is in the cache', 'no worker, so no cache to inspect — this would pass vacuously')
  skip('everything cached is a shell asset', 'same: an empty cache satisfies it and proves nothing')
  skip('a data page comes off the network', 'no worker to bypass')
  skip('OFFLINE renders the honest offline state', 'the offline fallback is the worker\'s job')
  skip('offline shows NO figures', 'same')
  await browser.close()
  console.log(`\n  ${skipped} assertion(s) skipped, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
}
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
  p === '/' || p.startsWith('/rooms/') || p === '/facts' || p === '/tournaments'
  || p === '/promos' || p === '/install')
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
/* `waitUntil: 'load'` can reject AND leave a navigation in flight, so the next
   `page.evaluate` runs against a context that is being torn down — "Execution
   context was destroyed". Waiting for `domcontentloaded` and then settling
   avoids reading mid-navigation. */
await page.goto(`${BASE}/rooms/orleans`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.waitForTimeout(800)
const offline = await page.evaluate(() => document.body.textContent ?? '').catch(() => '')
ok(/can.{0,3}t reach the data/i.test(offline),
  'offline renders the honest offline state')
ok(!/CASH GAMES/.test(offline) && !/\$\d+\/\d+/.test(offline),
  'and shows NO figures — not yesterday\'s rake wearing today\'s date')
await ctx.setOffline(false)

/* ══════════════════════════════════════════════════════════════════════════
   5. /install — THE PAGE THAT MAKES ANY OF THE ABOVE REACHABLE
   ══════════════════════════════════════════════════════════════════════════
   Everything above this line has passed since 2026-08-07 while nobody could
   find the feature it certifies. These assertions cover the page that says so.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n-- /install --\n')

const installRes = await page.request.get(`${BASE}/install`)
ok(installRes.ok(), `/install is served (${installRes.status()})`)

const svgRes = await page.request.get(`${BASE}/install/qr.svg`)
ok(svgRes.ok() && (svgRes.headers()['content-type'] ?? '').includes('image/svg+xml'),
  'the QR is served from our own origin as SVG',
  `${svgRes.status()} ${svgRes.headers()['content-type'] ?? ''}`)

/**
 * ⚠️ THE QR IS DECODED, NOT TRUSTED.
 *
 * An unscannable or wrong QR code is invisible to every other check in this
 * repo and to every human reviewer. It renders as a tidy square of dots, it is
 * the right size, its contrast passes the palette gate, and it fails only in a
 * stranger's phone camera — which is not a thing CI holds. A generator with one
 * transposed table number produces exactly that: a picture of a QR code.
 *
 * So the symbol is read back out of the PIXELS THE BROWSER PAINTED, by a
 * decoder that shares no code with the renderer (`lib/qr-decode.ts` states what
 * it does share, and why that is checked separately). That path catches a wrong
 * URL, an inverted or low-contrast colour pair, a CSS rule that scaled the
 * symbol to a fractional module width, and a missing quiet zone.
 */
await page.goto(`${BASE}/install?platform=desktop`, { waitUntil: 'load' })
await page.waitForTimeout(400)

const shot = await page.evaluate(async () => {
  const img = document.querySelector('.cid-qr img')
  if (!img) return { error: 'no .cid-qr img on the page' }
  if (!img.complete) await img.decode().catch(() => {})
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) return { error: 'the QR image has no intrinsic size' }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const cx = canvas.getContext('2d')
  /* An explicit white ground: an SVG with a transparent background would
     otherwise composite onto black and invert the whole symbol. */
  cx.fillStyle = '#ffffff'
  cx.fillRect(0, 0, w, h)
  cx.drawImage(img, 0, 0, w, h)
  const { data } = cx.getImageData(0, 0, w, h)
  const luma = new Array(w * h)
  for (let i = 0; i < luma.length; i++) {
    luma[i] = Math.round(0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2])
  }
  /* THE SECOND OPINION, where the platform has one. Chromium exposes
     BarcodeDetector on macOS and Android (backed by the OS decoder) and NOT on
     Linux — so this is a real production decoder locally and a named skip in
     CI, rather than a check that quietly does nothing on both. */
  let native = null
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats()
      if (formats.includes('qr_code')) {
        const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(canvas)
        native = found.map((f) => f.rawValue)
      }
    } catch (e) { native = { error: String(e) } }
  }
  return { data: luma, width: w, height: h, native, cssWidth: Math.round(img.getBoundingClientRect().width) }
})

if (shot.error) {
  ok(false, 'the QR code renders', shot.error)
  skip('the QR encodes the install URL', 'nothing was rendered to decode')
  skip('the QR keeps its quiet zone', 'same')
} else {
  let read = null
  let located = null
  try {
    located = matrixFromLuma(shot)
    read = decodeMatrix(located.matrix)
  } catch (e) {
    ok(false, 'the QR could be located and decoded from the rendered pixels', String(e.message))
  }
  if (read) {
    ok(read.text === INSTALL_URL,
      'the QR encodes the install URL — decoded from the pixels, not taken on trust',
      `read "${read.text}", expected "${INSTALL_URL}"`)
    ok(read.version === 3 && read.ecc === 'Q',
      'at the version and error-correction level intended',
      `version ${read.version}, level ${read.ecc}, mask ${read.mask}`)
    /* FOUR MODULES OF CLEAR SPACE is the spec's minimum and the single most
       common reason a QR that looks fine will not scan. */
    const quiet = located.box.left / located.moduleSize
    ok(quiet >= 4, 'the QR keeps its four-module quiet zone',
      `${quiet.toFixed(1)} modules of clear space, module size ${located.moduleSize.toFixed(1)}px`)
    /* A SYMBOL SCALED TO A FRACTIONAL MODULE WIDTH renders some modules a pixel
       wider than their neighbours, which is geometric noise a scanner has to
       work through. Caught here on its first run: the CSS capped the image at
       72vw, so at 390px it drew 281px across a 37-module grid — 7.59px each. */
    const grid = Math.round(quiet) * 2 + located.matrix.length
    ok(shot.cssWidth % grid === 0,
      'the symbol renders at a whole number of pixels per module',
      `${shot.cssWidth}px across ${grid} modules = ${(shot.cssWidth / grid).toFixed(2)}px each`)
  }
  if (Array.isArray(shot.native)) {
    ok(shot.native.length === 1 && shot.native[0] === INSTALL_URL,
      'and a REAL scanner agrees — the platform barcode detector reads the same URL',
      shot.native.join(', ') || 'the detector found nothing in the image')
  } else {
    skip('a real scanner reads the same URL',
      shot.native?.error
        ? `the platform detector failed: ${shot.native.error}`
        : 'this platform has no BarcodeDetector (Chromium ships it on macOS and Android, not Linux)')
  }
}

/**
 * THE SAME PROMISE, APPLIED TO THE NEWEST PAGE. The cache assertions above ran
 * before /install existed, so they proved nothing about it. This re-inspects
 * after the page and its image have loaded, and the two halves are deliberately
 * different: the PAGE must not be stored, and the QR — an image we ship whole
 * and replace by deploy, exactly like the icons — may be.
 */
const afterInstall = await page.evaluate(async () => {
  const out = []
  for (const n of await caches.keys()) {
    const c = await caches.open(n)
    for (const req of await c.keys()) out.push(new URL(req.url).pathname)
  }
  return out
})
ok(!afterInstall.includes('/install'),
  'the install PAGE is not in the cache either — the promise covers every page, including the new one',
  afterInstall.filter((p) => p.startsWith('/install')).join(', ') || 'no /install entry')
ok(afterInstall.includes('/install/qr.svg'),
  'but the QR image IS cached, like every other icon we ship whole and replace by deploy',
  afterInstall.filter((p) => p.startsWith('/install')).join(', ') || 'NOT CACHED — the shell rule stopped matching it')

/* ── THE BRANCHES: ONE SET OF INSTRUCTIONS, NEVER THREE ─────────────────── */
const branchOf = async (path, ua) => {
  const c = await browser.newContext(ua ? { userAgent: ua } : {})
  const p = await c.newPage()
  await p.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await p.waitForTimeout(500)
  const r = await p.evaluate(() => ({
    branches: [...document.querySelectorAll('[data-install]')].map((e) => e.dataset.install),
    text: document.body.textContent ?? '',
    buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()),
    qr: document.querySelector('.cid-qr img') != null,
    glyph: document.querySelector('.cid-glyph svg') != null,
  }))
  await c.close()
  return r
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const ios = await branchOf('/install', IPHONE_UA)
ok(ios.branches.length === 1 && ios.branches[0] === 'ios',
  'an iPhone gets the iOS steps, and ONLY those', ios.branches.join(', ') || 'none')
ok(ios.glyph, 'the Share glyph is DRAWN — not a screenshot of somebody else\'s iOS version')
ok(!ios.qr, 'and no QR code, which would be a picture of the page it is already on')

const android = await branchOf('/install', ANDROID_UA)
ok(android.branches.length === 1 && android.branches[0] === 'android',
  'an Android phone gets the Android steps, and ONLY those', android.branches.join(', ') || 'none')
/**
 * ⚠️ NO DEAD BUTTON. Headless Chromium never fires `beforeinstallprompt`, so
 * this run is the "the browser offered nothing" state — the same state a
 * Firefox or Samsung Internet reader is in, and the same state somebody who has
 * already installed the app is in. A button rendered here would do nothing when
 * tapped, which is worse than no button: it reads as a broken product rather
 * than as an unavailable shortcut. The menu route is rendered instead, always,
 * and the button is only ever added on top of it.
 */
ok(!android.buttons.some((b) => /HOME SCREEN|INSTALL/i.test(b)),
  'no install button when the browser has not offered a prompt',
  android.buttons.join(' | ') || 'no buttons at all')
ok(/Install app/i.test(android.text) && /menu/i.test(android.text),
  'and the browser-menu route is spelled out instead, which always works')

/**
 * ⚠️ THE BUTTON, DRIVEN THROUGH ITS STATES.
 *
 * Everything above measures the state where the browser offered nothing, which
 * is the only state headless Chromium produces on its own — so without this the
 * button would ship having never been rendered, let alone clicked, by anything.
 * The event is SYNTHETIC and that is the honest limit: it proves the app's state
 * machine, which is the part written here, and not that Chromium fires the
 * event. The three states below are the ones that go wrong in the wild:
 *
 *   OFFERED    the button appears at all, and only once an event exists.
 *   ACCEPTED   the page says the thing is installed rather than sitting there
 *              still offering to install it.
 *   DISMISSED  the button is GONE, not re-armed. `prompt()` may be called once
 *              per event; a re-armed button throws on the second tap, which is
 *              a button that does nothing — the exact failure this design was
 *              shaped to avoid.
 */
const androidStates = async (choice) => {
  const c = await browser.newContext({ userAgent: ANDROID_UA })
  const p = await c.newPage()
  await p.goto(`${BASE}/install`, { waitUntil: 'load' })
  await p.waitForTimeout(600)
  const before = await p.evaluate(() => document.querySelectorAll('.cid-install-btn').length)
  await p.evaluate((outcome) => {
    const e = new Event('beforeinstallprompt')
    e.prompt = async () => {}
    e.userChoice = Promise.resolve({ outcome, platform: 'web' })
    window.dispatchEvent(e)
  }, choice)
  await p.waitForTimeout(300)
  const offered = await p.evaluate(() => {
    const b = document.querySelector('.cid-install-btn')
    return { present: b != null, label: (b?.textContent ?? '').trim() }
  })
  if (offered.present) await p.click('.cid-install-btn')
  await p.waitForTimeout(400)
  const after = await p.evaluate(() => ({
    button: document.querySelectorAll('.cid-install-btn').length,
    text: document.body.textContent ?? '',
  }))
  await c.close()
  return { before, offered, after }
}

const accepted = await androidStates('accepted')
ok(accepted.before === 0 && accepted.offered.present,
  'the install button appears ONLY once the browser has offered a prompt',
  `before the event: ${accepted.before}; after: ${accepted.offered.label || 'absent'}`)
ok(accepted.after.button === 0 && /Installed/i.test(accepted.after.text),
  'accepting says it is installed, and stops offering to install it',
  `${accepted.after.button} button(s) left`)

const dismissed = await androidStates('dismissed')
ok(dismissed.after.button === 0,
  'dismissing REMOVES the button rather than re-arming it — the event is consumed and a second tap would throw')
ok(/nothing was installed/i.test(dismissed.after.text) && /menu/i.test(dismissed.after.text),
  'and the page says plainly that nothing was installed, and where the menu item is')

const desktop = await branchOf('/install', null)
ok(desktop.branches.length === 1 && desktop.branches[0] === 'desktop',
  'a computer gets the QR branch, and ONLY that', desktop.branches.join(', ') || 'none')
ok(desktop.qr, 'the QR is on the desktop branch, where it is the only thing that helps')

/* ── THE ENTRY POINT ────────────────────────────────────────────────────── */
const footer = await page.evaluate(async () => {
  const seen = {}
  for (const path of ['/', '/facts', '/tournaments', '/promos']) {
    const html = await (await fetch(path)).text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = [...doc.querySelectorAll('footer a')]
    seen[path] = links.map((a) => a.getAttribute('href'))
  }
  return seen
})
ok(Object.values(footer).every((hrefs) => hrefs.length === 1 && hrefs[0] === '/install'),
  'every page carries exactly ONE footer link, and it points at /install',
  Object.entries(footer).map(([p, h]) => `${p}:[${h.join(',')}]`).join(' '))
/* THE RULING WAS "QUIET". An interstitial, a banner over the map or a toast
   would all satisfy "the link exists" and all break it. */
const nagging = await page.evaluate(async () => {
  const html = await (await fetch('/')).text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('a[href="/install"], a[href^="/install?"]')].length
})
ok(nagging === 1, 'and the map page mentions installing exactly once — no banner, no interstitial',
  `${nagging} link(s) to /install on the landing page`)

/* ══════════════════════════════════════════════════════════════════════════
   6. THE INSTALLED-APP TRAP
   ══════════════════════════════════════════════════════════════════════════
   A PWA has its OWN STORAGE, separate from the browser that installed it. A
   magic link opened from a mail app lands in the BROWSER, so the session is
   written to a cookie jar the installed app cannot read. Standing inside the
   app, /admin's sign-in form is a form that can never complete: the link is
   consumed, nothing errors, nothing logs, and the obvious next move is to
   request another one and do it again.

   ⚠️ THE DISPLAY MODE IS STUBBED, AND THAT LIMIT IS REAL. Headless Chromium
   will not report `display-mode: standalone`: CDP's `Emulation.setEmulatedMedia`
   ACCEPTS the feature and silently ignores it (measured — the command returns
   {} and the query still matches `browser`), `--app=` is ignored in headless,
   and there is no Playwright API for it. So the query is overridden in an init
   script instead.
   WHAT THAT PROVES AND WHAT IT DOES NOT: it proves the app's branch — given the
   browser says standalone, the form is withheld and the reason is stated, which
   is the part written here and the part that can regress. It does NOT prove the
   platform reports standalone to a really-installed app. That is why BOTH
   spellings are exercised below: the media query Android and desktop use, and
   `navigator.standalone`, which is the ONLY signal iOS gives — and iOS is where
   this trap actually bites, because the magic link lands in Safari.
   ══════════════════════════════════════════════════════════════════════════ */
console.log('\n-- the installed-app trap --\n')

/** Two contexts, one per spelling of "this is an installed app". */
const standaloneContext = async (how) => {
  const c = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
  await c.addInitScript(`(${(spelling) => {
    if (spelling === 'ios') {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
      return
    }
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
      ? {
        matches: true, media: q, onchange: null,
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false },
        addListener() {}, removeListener() {},
      }
      : real(q))
  }})(${JSON.stringify(how)})`)
  return c
}

const inApp = async (ctx, path) => {
  const p = await ctx.newPage()
  await p.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await p.waitForTimeout(600)
  const r = await p.evaluate(() => ({
    text: document.body.textContent ?? '',
    emailInput: document.querySelector('input[type=email]') != null,
    marker: document.querySelector('[data-admin]')?.dataset.admin ?? null,
    installMarker: document.querySelector('[data-install]')?.dataset.install ?? null,
  }))
  await p.close()
  return r
}

const mqCtx = await standaloneContext('display-mode')
const appAdmin = await inApp(mqCtx, '/admin')
ok(appAdmin.marker === 'standalone' && /browser/i.test(appAdmin.text),
  'the installed app is told to sign in from a browser, and why',
  appAdmin.marker ?? 'the standalone branch did not render')
ok(!appAdmin.emailInput,
  'and the sign-in form is not offered inside the app — a form that cannot complete invites the loop')
const appInstall = await inApp(mqCtx, '/install')
ok(appInstall.installMarker === 'standalone' && /already installed/i.test(appInstall.text),
  '/install says it is already installed rather than offering a prompt that will never fire',
  appInstall.installMarker ?? 'the standalone branch did not render')
await mqCtx.close()

/* THE iOS SPELLING, SEPARATELY. `navigator.standalone` predates the media query
   and is still the only thing Safari sets — a detector that checked the query
   alone would pass every assertion above and fail on every iPhone, which is the
   one platform where this trap is unavoidable. */
const iosCtx = await standaloneContext('ios')
const iosAdmin = await inApp(iosCtx, '/admin')
ok(iosAdmin.marker === 'standalone' && !iosAdmin.emailInput,
  'the iOS spelling counts too — navigator.standalone, which Safari sets and the media query does not cover',
  iosAdmin.marker ?? 'the standalone branch did not render')
await iosCtx.close()

/* THE POSITIVE CONTROL, and it is the assertion that gives the four above
   their meaning. A page that refused everybody would satisfy all of them. */
const browserAdmin = await branchOf('/admin', null)
ok(browserAdmin.text.includes('EMAIL') || /SEND SIGN-IN LINK/i.test(browserAdmin.text),
  '...and in an ordinary browser tab the form IS offered',
  browserAdmin.buttons.join(' | ') || 'no form found')

await browser.close()
console.log(`\n  ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\n`)
process.exit(failed ? 1 : 0)
