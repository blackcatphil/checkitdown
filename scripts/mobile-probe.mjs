#!/usr/bin/env node
/**
 * IS THE MAP A DEFENSIBLE LANDING VIEW ON A PHONE?
 *
 * Phil's ruling is that most people will use this after they leave their room,
 * which means a phone on hotel wifi or cellular. MapLibre + WebGL + vector
 * tiles at the Strip camera is the heaviest thing in the app by a wide margin,
 * and the desktop probe measures it on an unthrottled laptop at 1440x900 — a
 * machine nobody will be holding.
 *
 * So this measures the same map at a PHONE viewport on a THROTTLED CPU, and
 * reports the numbers that decide whether the landing view survives contact
 * with the actual device. A mobile-specific entry view is a legitimate answer;
 * inventing one without measuring first is not, and neither is shipping the
 * map because it happens to work on a MacBook.
 *
 *   node scripts/mobile-probe.mjs [url]
 *   MOBILE_PROBE_CPU=6 node scripts/mobile-probe.mjs    # harsher throttle
 *
 * WHAT IT MEASURES, AND WHY EACH ONE
 *   time to first extrusion  — not "load", not "style loaded". The moment a
 *                              building mass is actually on screen is the
 *                              moment the landing view has delivered its point.
 *   long tasks               — a phone drops frames where a laptop does not;
 *                              a 500ms task is a visibly frozen tap.
 *   frame interval at drag   — the map's own rendering, measured while the
 *                              camera moves, which is when a phone struggles.
 *   reachability + overlap   — the desktop assertions, re-run at 390px. A
 *                              cluster layout tuned at 1440px is not the same
 *                              layout at 390px, and pins that separate cleanly
 *                              on a laptop can collide on a phone.
 *
 * THROTTLING IS AN APPROXIMATION AND IS LABELLED AS ONE. A 4x CPU slowdown on
 * this machine is not a specific handset. It is a defensible stand-in for
 * "mid-range Android", and the number that matters is the SHAPE — does it take
 * two seconds or twelve.
 */
import { chromium, devices } from 'playwright'

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3100'
const CPU_THROTTLE = Number(process.env.MOBILE_PROBE_CPU ?? 4)

/* 390x844 is the iPhone 12/13/14/15 viewport and the most common phone size in
   the wild. DPR 3 is deliberate: it triples the pixels the GPU actually fills,
   which is the cost a CSS-pixel measurement hides. */
const PHONE = { width: 390, height: 844 }

let failed = 0
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: PHONE,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()

/* Playwright has no CPU throttle; CDP does. Chromium-only, which is fine —
   this is a measurement rig, not a cross-browser test. */
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

const longTasks = []
await page.addInitScript(() => {
  window.__cid_long = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__cid_long.push(Math.round(e.duration))
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* older engines */ }
})

const t0 = Date.now()
await page.goto(BASE, { waitUntil: 'load' })
const loadAt = Date.now() - t0

/* TIME TO FIRST EXTRUSION. Polls the live map for a rendered mass feature
   rather than waiting a fixed interval — the number has to be the moment the
   thing appeared, not the moment we decided to look. */
let firstExtrusion = null
const deadline = Date.now() + 30000
while (Date.now() < deadline) {
  const n = await page.evaluate(() => {
    const m = window.__cid_map
    if (!m || !m.getLayer?.('rooms-fp')) return 0
    try { return m.queryRenderedFeatures({ layers: ['rooms-fp'] }).length } catch { return 0 }
  })
  if (n > 0) { firstExtrusion = Date.now() - t0; break }
  await page.waitForTimeout(120)
}

const canvas = await page.$('canvas.maplibregl-canvas')
const geom = canvas ? await canvas.boundingBox() : null

/* FRAME INTERVAL WHILE THE CAMERA MOVES. A still map is cheap on any device;
   the cost lands on drag, which is the only way to see a phone struggle. */
let frames = null
if (canvas) {
  await page.evaluate(() => {
    window.__cid_frames = []
    const m = window.__cid_map
    let last = performance.now()
    m.on('render', () => {
      const now = performance.now()
      window.__cid_frames.push(now - last)
      last = now
    })
  })
  await page.touchscreen.tap(195, 400)
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(195, 500)
    await page.mouse.down()
    await page.mouse.move(195 + (i % 2 ? -60 : 60), 430, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(120)
  }
  frames = await page.evaluate(() => {
    const f = (window.__cid_frames ?? []).filter((x) => x > 0 && x < 2000)
    if (!f.length) return null
    const s = [...f].sort((a, b) => a - b)
    return {
      n: f.length,
      median: Math.round(s[Math.floor(s.length / 2)]),
      p95: Math.round(s[Math.floor(s.length * 0.95)]),
      worst: Math.round(s[s.length - 1]),
    }
  })
}

longTasks.push(...(await page.evaluate(() => window.__cid_long ?? [])))

/* THE VALLEY CAMERA, because that is where "all 17 rooms" is a claim.
   The first version measured reachability at the LANDING (Strip) camera and
   demanded all seventeen, which the desktop probe never does — at z14.5 most of
   the valley is off-screen by design, and the assertion was failing on correct
   behaviour. The 17-room accounting and the pin-overlap check both belong at
   z10, which is the view whose whole job is "every room in the valley". */
/* CLICK THE REAL CONTROL rather than jumping to a hardcoded camera. A probe
   that sets its own zoom tests the number it just typed; clicking "WHOLE
   VALLEY" tests what a reader gets. The first version jumped to z10 and found
   15 of 17 — a true reading of a camera the app no longer uses on a phone. */
const sheet = await page.$('.cid-sheet-handle')
if (sheet) await sheet.click()
await page.waitForTimeout(400)
const valleyBtn = await page.$('button.cid-viewbtn:has-text("WHOLE VALLEY")')
if (valleyBtn) await valleyBtn.click()
await page.waitForTimeout(3000)
const valleyZoom = await page.evaluate(() => window.__cid_map.getZoom())

/* THE DESKTOP ASSERTIONS, AT 390px. Reachability is measured by SCREEN
   PROJECTION, not getBounds().contains() — at pitch, a room can be inside the
   geographic bounds and project off-screen, which is how Orleans once counted
   as "in view" at x = -465. */
const reach = await page.evaluate(() => {
  const m = window.__cid_map
  if (!m) return null
  const src = m.getSource('rooms')
  const { width, height } = m.getCanvas().getBoundingClientRect()
  const onScreen = (p) => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height
  const feats = m.querySourceFeatures('rooms')
  const singles = []
  const clusters = []
  for (const f of feats) {
    if (f.properties.point_count) clusters.push(f)
    else singles.push(f)
  }
  /* DEDUPE BY SLUG FIRST. `querySourceFeatures` returns features from every
     LOADED TILE, and a point near a tile boundary appears in both — so the same
     room comes back twice, projects to the same pixel, and reads as a pair of
     pins sitting exactly on top of each other.
     That is what the first version reported: 2 "overlapping pairs" at 390px
     that were 2 rooms counted twice. It was immune to the cluster radius —
     50, 64, 80 and 96 all produced the identical 2 — which is what gave it
     away, because a real crowding problem responds to clustering. */
  const byslug = new Map()
  for (const f of singles) {
    if (!byslug.has(f.properties.slug)) {
      byslug.set(f.properties.slug, m.project(f.geometry.coordinates))
    }
  }
  const pins = [...byslug.entries()]
    .map(([slug, pt]) => ({ slug, pt }))
    .filter((p) => onScreen(p.pt))
  const dupes = singles.length - byslug.size
  /* ZERO OVERLAP BETWEEN RENDERED PINS. 7px radius plus a 1px stroke = 16px
     between centres before two dots touch. */
  let overlaps = 0
  const collisions = []
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const d = Math.hypot(pins[i].pt.x - pins[j].pt.x, pins[i].pt.y - pins[j].pt.y)
      if (d < 16) { overlaps++; collisions.push(`${pins[i].slug}~${pins[j].slug} ${d.toFixed(1)}px`) }
    }
  }
  const clustered = clusters.reduce((a, f) => a + f.properties.point_count, 0)
  return { pins: pins.length, clusters: clusters.length, clustered, overlaps, collisions, dupes, src: Boolean(src) }
})

const masses = await page.evaluate(() => {
  const m = window.__cid_map
  try { return m.queryRenderedFeatures({ layers: ['rooms-fp'] }).length } catch { return 0 }
})

console.log(`\nMOBILE PROBE — ${PHONE.width}x${PHONE.height} @ DPR 3, CPU throttle ${CPU_THROTTLE}x`)
console.log(`  (an approximation of a mid-range handset, not a specific device)\n`)
console.log(`  load event            ${loadAt} ms`)
console.log(`  FIRST EXTRUSION       ${firstExtrusion == null ? 'NEVER (30s)' : `${firstExtrusion} ms`}`)
console.log(`  canvas                ${geom ? `${Math.round(geom.width)}x${Math.round(geom.height)}` : 'none'}`)
console.log(`  long tasks (>50ms)    ${longTasks.length}${longTasks.length ? ` — worst ${Math.max(...longTasks)} ms, total ${longTasks.reduce((a, b) => a + b, 0)} ms` : ''}`)
if (frames) console.log(`  frame interval @ drag median ${frames.median} ms · p95 ${frames.p95} ms · worst ${frames.worst} ms (${frames.n} frames)`)
console.log(`  valley zoom           ${valleyZoom?.toFixed?.(2) ?? '—'} (phone step; desktop is 10)`)
if (reach) console.log(`  rooms                 ${reach.pins} pins + ${reach.clustered} clustered in ${reach.clusters} clusters · ${masses} masses`
  + `${reach.dupes ? ` (${reach.dupes} cross-tile duplicates deduped)` : ''}`)

console.log('')
ok(geom != null && geom.width > 0, `the map has a viewport at ${PHONE.width}px (canvas is not 0x0)`)
ok(firstExtrusion != null, 'a building mass renders at all on a phone viewport')
ok(reach != null && reach.pins + reach.clustered === 17,
  `all 17 rooms are accounted for at 390px (${reach ? reach.pins + reach.clustered : '?'})`)
ok(reach != null && reach.overlaps === 0,
  `zero overlap between rendered pins at 390px${reach?.collisions?.length ? ` — ${reach.collisions.join(', ')}` : ''}`)

/* ── THE OTHER FOUR SURFACES ──────────────────────────────────────────────
   The map was the risky one, so it is measured first and hardest. But the
   failure that would actually have shipped was duller and on every page at
   once: 494px of scroll width against a 390px viewport, caused by the shared
   header — brand, four nav items and the trust line, all `nowrap`, in a row
   that cannot shrink. Four pages, one cause. Checking only the map would have
   missed it entirely. */
const page2 = await ctx.newPage()
for (const [path, label] of [
  ['/facts', 'facts'], ['/rooms/wynn-encore', 'room detail'],
  ['/tournaments', 'tournaments'], ['/promos', 'promos'], ['/', 'map'],
]) {
  await page2.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await page2.waitForTimeout(1200)
  const r = await page2.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    /* WCAG 2.5.8 exempts a link inline in a sentence, and controls whose
       presentation is required by law — which covers the map's attribution.
       A checkbox's target is its label, which is what a finger hits. */
    small: [...document.querySelectorAll('a,button,input')].filter((e) => {
      const b = e.getBoundingClientRect()
      if (!(b.width > 0 && b.height > 0) || b.height >= 44) return false
      if (e.closest('.maplibregl-ctrl-attrib')) return false
      const inline = getComputedStyle(e).display === 'inline'
      if (e.tagName === 'A' && inline && e.closest('p, li')) return false
      const lab = e.closest('label')
      if (e.tagName === 'INPUT' && lab && lab.getBoundingClientRect().height >= 44) return false
      return true
    }).map((e) => `${e.tagName}:${(e.textContent ?? '').trim().slice(0, 16)}`),
    headHidden: [...document.querySelectorAll('.cid-thead')]
      .every((e) => getComputedStyle(e).display === 'none'),
    rankQ: document.querySelector('.cid-rank-q')?.textContent ?? null,
  }))
  ok(r.scrollW <= r.clientW + 1, `${label}: no horizontal overflow (${r.scrollW} vs ${r.clientW})`)
  ok(r.small.length === 0, `${label}: every standalone target clears 44px${r.small.length ? ` — ${r.small.slice(0, 3).join(', ')}` : ''}`)
  if (path === '/facts') {
    ok(r.headHidden, 'facts: the table head is gone — these are cards, not a squeezed table')
    /* RANK IS TIED TO THE SORT. On the table the qualifier is the column head;
       with the head hidden, "#3" alone is a number attached to nothing. */
    ok((r.rankQ ?? '').length > 0, `facts: the rank qualifier survives on the card (${r.rankQ ?? 'MISSING'})`)
  }
}

await browser.close()
process.exit(failed ? 1 : 0)
