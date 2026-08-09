#!/usr/bin/env node
/**
 * ONE MOBILE PASS: the entry-zoom table, and the rooftop flicker diagnosis.
 *
 * Both questions are about the same frame — a 390px viewport at DPR 3 with the
 * bottom nav rendered — so they are measured in one run rather than two, and
 * the canvas they share is measured rather than assumed. That last part is the
 * 88-pixel lesson: the map was once 88px wide because nobody read the canvas
 * back after the layout around it changed, and the bottom nav has just changed
 * it again.
 *
 *   NEXT_PUBLIC_MAP_DEBUG=1 npm run dev
 *   node scripts/mobile-map-rig.mjs [url]
 *
 * PART A — ENTRY ZOOM. For each candidate: how many of the 17 rooms are on
 * screen, how many pins actually render, and the closest gap between two of
 * them. The absorption rules are LIFTED FROM THE MOBILE PROBE rather than
 * re-derived — dedupe by slug (a point near a tile boundary is returned by both
 * tiles and reads as two pins on one pixel), project rather than trust bounds
 * (at pitch a room can be inside the bounds and off-screen), 16px between
 * centres before two 7px dots touch.
 *
 * PART B — FLICKER. Diagnose, do not assume. Three questions, in order:
 *   1. does it appear only while the camera MOVES?
 *   2. does it vanish when the roof-ring layer is hidden?
 *   3. is it stipple (isolated pixels disagreeing with both neighbours), which
 *      is what a depth tie looks like, rather than a smooth shift?
 * Only all three together identify z-fighting. Any other combination means the
 * mechanism is something else and the fix would have been aimed at the wrong
 * thing.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000'
const ZOOMS = [14.5, 14.25, 14.0]
const STRIP = [-115.1726, 36.112]

const browser = await chromium.launch()
/* REDUCED MOTION, AND IT IS NOT A CONVENIENCE — IT IS WHAT MAKES THE
   MEASUREMENT VALID. The map runs a WELCOME DRIFT: an idle rAF loop that
   rotates the bearing continuously and restarts itself one second after the
   last interaction. The first run of this rig reported 30.91% pixel churn
   between two screenshots at a "fixed" camera, which is not a depth tie — it is
   a camera that was never fixed. Every number in Part A was contaminated the
   same way, since the bearing drifted between jumpTo and measure.
   The drift effect returns early under `prefers-reduced-motion`, so emulating
   it stops the loop at its source rather than fighting it with synthetic
   pointer events that the 1s restart tick would undo anyway.
   The static-churn number below is the CONTROL: if it is not ~0, nothing after
   it means anything and the run should be thrown away. */
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
})
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'networkidle' })

const hasHandle = await page
  .waitForFunction(() => typeof window.__cid_map !== 'undefined', null, { timeout: 8000 })
  .then(() => true).catch(() => false)
if (!hasHandle) {
  console.log('window.__cid_map is absent — run dev with NEXT_PUBLIC_MAP_DEBUG=1')
  await browser.close(); process.exit(1)
}
await page.waitForTimeout(1500)

/* THE CANVAS, READ BACK. */
const frame = await page.evaluate(() => {
  const m = window.__cid_map
  const r = m.getCanvas().getBoundingClientRect()
  const nav = document.querySelector('.cid-botnav')
  const nb = nav ? nav.getBoundingClientRect() : null
  return {
    canvas: { w: Math.round(r.width), h: Math.round(r.height) },
    navPresent: Boolean(nav),
    navH: nb ? Math.round(nb.height) : 0,
    navTop: nb ? Math.round(nb.top) : 0,
    dpr: window.devicePixelRatio,
  }
})
console.log('\n=== THE FRAME BEING MEASURED ===')
console.log(`viewport 390x844 · DPR ${frame.dpr} · canvas ${frame.canvas.w}x${frame.canvas.h}`)
console.log(`bottom nav rendered: ${frame.navPresent} · height ${frame.navH}px · top edge y=${frame.navTop}`)

/* ---------------- PART A: the entry-zoom table ---------------- */
const measureAt = async (z) => {
  await page.evaluate(([center, zoom]) => {
    window.__cid_map.jumpTo({ center, zoom, pitch: 52, bearing: -18 })
  }, [STRIP, z])
  await page.waitForTimeout(900)
  return page.evaluate(() => {
    const m = window.__cid_map
    const { width, height } = m.getCanvas().getBoundingClientRect()
    const onScreen = (p) => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height
    const feats = m.querySourceFeatures('rooms')
    const singles = [], clusters = []
    for (const f of feats) (f.properties.point_count ? clusters : singles).push(f)

    const byslug = new Map()
    for (const f of singles) {
      if (!byslug.has(f.properties.slug)) byslug.set(f.properties.slug, m.project(f.geometry.coordinates))
    }
    const pins = [...byslug.entries()].map(([slug, pt]) => ({ slug, pt })).filter((p) => onScreen(p.pt))

    /* Rooms REPRESENTED on screen: rendered pins plus everything inside an
       on-screen cluster. A room absorbed into a visible cluster is reachable;
       a room whose cluster is off-screen is not. */
    let clusteredOnScreen = 0, clustersOn = 0
    for (const c of clusters) {
      if (onScreen(m.project(c.geometry.coordinates))) { clustersOn++; clusteredOnScreen += c.properties.point_count }
    }

    let overlaps = 0, closest = Infinity, closestPair = ''
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const d = Math.hypot(pins[i].pt.x - pins[j].pt.x, pins[i].pt.y - pins[j].pt.y)
        if (d < closest) { closest = d; closestPair = `${pins[i].slug}~${pins[j].slug}` }
        if (d < 16) overlaps++
      }
    }
    const masses = (() => { try { return m.queryRenderedFeatures({ layers: ['rooms-fp'] }).length } catch { return 0 } })()
    return {
      pins: pins.length, clustersOn, clusteredOnScreen,
      represented: pins.length + clusteredOnScreen,
      overlaps, closest: closest === Infinity ? null : Number(closest.toFixed(1)), closestPair,
      masses, zoom: m.getZoom(),
    }
  })
}

console.log('\n=== PART A — ENTRY ZOOM at 390px, nav rendered ===')
const rows = []
for (const z of ZOOMS) rows.push({ zoom: z, ...(await measureAt(z)) })
console.table(rows.map((r) => ({
  zoom: r.zoom,
  'rooms on screen': `${r.represented} / 17`,
  'pins rendered': r.pins,
  'clusters on screen': r.clustersOn,
  'closest pin gap px': r.closest ?? '—',
  overlaps: r.overlaps,
  'masses drawn': r.masses,
})))
for (const r of rows) if (r.closestPair) console.log(`  z${r.zoom}: closest pair ${r.closestPair} at ${r.closest}px`)

/* ---------------- PART B: the flicker ---------------- */
console.log('\n=== PART B — ROOFTOP FLICKER, diagnosed ===')

/* The Strip at the entry camera, where the towers are. */
await page.evaluate(([c]) => window.__cid_map.jumpTo({ center: c, zoom: 14.5, pitch: 52, bearing: -18 }), [STRIP])
await page.waitForTimeout(1200)

const shot = async () => (await page.locator('canvas').first().screenshot()).toString('base64')

/** Count pixels that differ between two PNG-decoded frames, and how many of the
 *  differing pixels are ISOLATED — disagreeing with both horizontal neighbours,
 *  which is the signature of a depth tie rather than a smooth camera shift. */
const compare = await page.evaluate(async ([a, b]) => {
  const load = (d) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d
  })
  const [ia, ib] = await Promise.all([load(a), load(b)])
  const c = document.createElement('canvas')
  c.width = ia.width; c.height = ia.height
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, c.width, c.height).data
  g.clearRect(0, 0, c.width, c.height)
  g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, c.width, c.height).data
  const W = c.width, H = c.height
  const diff = new Uint8Array(W * H)
  let changed = 0
  for (let i = 0, p = 0; i < A.length; i += 4, p++) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
    if (d > 24) { diff[p] = 1; changed++ }
  }
  let isolated = 0
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x
      if (diff[p] && !diff[p - 1] && !diff[p + 1]) isolated++
    }
  }
  return { W, H, changed, isolated, pctChanged: +(changed / (W * H) * 100).toFixed(2),
           pctIsolated: changed ? +(isolated / changed * 100).toFixed(1) : 0 }
}, [await shot(), await shot()])

console.log(`\n  Q1  STATIC frame, rendered twice, camera untouched  [THE CONTROL]:`)
console.log(`      ${compare.changed} px changed (${compare.pctChanged}%) — a depth tie is deterministic at a fixed camera`)
if (compare.pctChanged > 1) {
  console.log('\n  *** CONTROL FAILED — something is repainting with the camera still.')
  console.log('  *** Every number below is measuring that instead. Do not read them.')
}

/** Nudge the camera by a hair and diff — this is where a tie shimmers. */
const underMotion = async () => {
  const before = await shot()
  await page.evaluate(() => {
    const m = window.__cid_map
    m.jumpTo({ center: m.getCenter(), zoom: m.getZoom() + 0.004, pitch: 52, bearing: -18 })
  })
  await page.waitForTimeout(500)
  const after = await shot()
  return page.evaluate(async ([a, b]) => {
    const load = (d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(ia, 0, 0); const A = g.getImageData(0, 0, c.width, c.height).data
    g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const B = g.getImageData(0, 0, c.width, c.height).data
    const W = c.width, H = c.height
    const diff = new Uint8Array(W * H); let changed = 0
    for (let i = 0, p = 0; i < A.length; i += 4, p++) {
      const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
      if (d > 24) { diff[p] = 1; changed++ }
    }
    let isolated = 0
    for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x
      if (diff[p] && !diff[p - 1] && !diff[p + 1]) isolated++
    }
    return { changed, isolated, pctChanged: +(changed / (W * H) * 100).toFixed(2),
             pctIsolated: changed ? +(isolated / changed * 100).toFixed(1) : 0 }
  }, [before, after])
}

const withRing = await underMotion()
console.log(`\n  Q2  UNDER CAMERA MOTION, roof ring PRESENT:`)
console.log(`      ${withRing.changed} px changed (${withRing.pctChanged}%), ${withRing.pctIsolated}% of them ISOLATED (stipple)`)

await page.evaluate(() => {
  const m = window.__cid_map
  for (const id of ['rooms-cap']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
})
await page.waitForTimeout(600)
const withoutRing = await underMotion()
console.log(`\n  Q3  SAME MOTION, roof ring HIDDEN:`)
console.log(`      ${withoutRing.changed} px changed (${withoutRing.pctChanged}%), ${withoutRing.pctIsolated}% ISOLATED`)

await page.evaluate(() => {
  const m = window.__cid_map
  if (m.getLayer('rooms-cap')) m.setLayoutProperty('rooms-cap', 'visibility', 'visible')
})

console.log('\n  --- VERDICT INPUTS ---')
console.log(`  static churn            ${compare.pctChanged}%   (want ~0: a tie is deterministic per camera)`)
console.log(`  motion churn, ring on   ${withRing.pctChanged}%  stipple ${withRing.pctIsolated}%`)
console.log(`  motion churn, ring off  ${withoutRing.pctChanged}%  stipple ${withoutRing.pctIsolated}%`)
const drop = withRing.changed ? (1 - withoutRing.changed / withRing.changed) * 100 : 0
console.log(`  hiding the ring removes ${drop.toFixed(1)}% of the churn`)

await browser.close()
