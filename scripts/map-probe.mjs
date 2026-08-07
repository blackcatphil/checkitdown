#!/usr/bin/env node
/**
 * MAP PROBE — the first thing in this project that OBSERVES THE MAP.
 *
 * Every previous map claim was reasoned, computed or eyeballed. Three of them
 * were wrong for weeks: the load-time problem was blamed on 83 setPaintProperty
 * calls, on the tile building layer, and on a throttled tab, while the real
 * cause was a container measured at 0x0. **A map with no viewport loads its
 * style, requests no tiles, throws nothing and logs nothing.** It is
 * indistinguishable from a slow map by every signal except the one this script
 * reads: DID IT ASK FOR TILES.
 *
 * So the pass condition is network traffic and painted pixels, never "the
 * canvas looks right" — the canvas looked right the whole time it was empty,
 * because an empty canvas over a dark background looks like a dark map.
 *
 *   node scripts/map-probe.mjs [url]        # default http://127.0.0.1:3100
 *   MAP_PROBE_RUNS=3 node scripts/map-probe.mjs   # cold/warm timing, n>1
 */
import { inflateSync } from 'node:zlib'
import { statSync, writeFileSync } from 'node:fs'

import { chromium } from 'playwright'

/* A minimal PNG reader, so the probe can measure WHAT IS ACTUALLY ON SCREEN
   rather than what the tokens say. A WebGL canvas cannot be read back without
   preserveDrawingBuffer, but a screenshot can. */
function decodePng(buf) {
  let pos = 8, idat = [], w = 0, h = 0, ct = 0
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9] }
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const nc = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * nc
  const out = Buffer.alloc(stride * h)
  let prev = Buffer.alloc(stride), i = 0
  for (let y = 0; y < h; y++) {
    const f = raw[i++]
    const line = Buffer.from(raw.subarray(i, i + stride)); i += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= nc ? line[x - nc] : 0, b = prev[x], c = x >= nc ? prev[x - nc] : 0
      if (f === 1) line[x] = (line[x] + a) & 255
      else if (f === 2) line[x] = (line[x] + b) & 255
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
    }
    line.copy(out, y * stride); prev = line
  }
  return { w, h, nc, px: out }
}

/**
 * WHAT FRACTION OF THE FRAME IS EACH HUE — the number that should have existed
 * before either palette pass.
 *
 * Two rounds of "too monochrome" came from colouring features that are not in
 * the view: indigo water and moss parks are real, but at the Strip landing
 * there is almost no water and very little park, so the frame resolved to
 * aubergine on aubergine on aubergine. Token-level tests cannot see this at
 * all — they check what a colour IS, never how much of the screen it covers.
 */
/** Share of pixels reading as gold — the observable for "did the wireframe
 *  paint", as opposed to "was it added". */
function countGold(shot) {
  const { w, h, nc, px } = decodePng(shot)
  let gold = 0, n = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * nc
      const r = px[o], g = px[o + 1], b = px[o + 2]
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      n++
      if (max - min < 6) continue
      const d = max - min
      let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      hh = (hh * 60 + 360) % 360
      if (hh >= 20 && hh < 70) gold++
    }
  }
  return +(gold / n * 100).toFixed(3)
}

function hueShare(shot) {
  const { w, h, nc, px } = decodePng(shot)
  const bucket = { neutral: 0, gold: 0, moss: 0, teal: 0, indigo: 0, aubergine: 0, other: 0 }
  let n = 0
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * nc
      const r = px[o], g = px[o + 1], b = px[o + 2]
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      n++
      if (max - min < 10) { bucket.neutral++; continue }
      const d = max - min
      let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      hh = (hh * 60 + 360) % 360
      if (hh >= 20 && hh < 70) bucket.gold++
      else if (hh >= 70 && hh < 160) bucket.moss++
      else if (hh >= 160 && hh < 200) bucket.teal++
      else if (hh >= 200 && hh < 258) bucket.indigo++
      else if (hh >= 258 && hh < 330) bucket.aubergine++
      else bucket.other++
    }
  }
  return Object.fromEntries(Object.entries(bucket).map(([k, v]) => [k, +(v / n * 100).toFixed(2)]))
}

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://127.0.0.1:3100'
const RUNS = Number(process.env.MAP_PROBE_RUNS ?? 1)
const BUDGET_MS = Number(process.env.MAP_PROBE_BUDGET ?? 20000)

const isTile = (u) => /\.pbf|\/planet\/|\/tiles\/.*\/\d+\/\d+\/\d+/.test(u)
const isStyle = (u) => /styles\/positron/.test(u) && !isTile(u)

async function probe(browser, { cold }) {
  /* A FRESH CONTEXT IS NOT A FRESH PROFILE, but it is a fresh HTTP cache, which
     is the part that governs tile timing. The distinction is recorded because
     "the load probably wasn't cold" has already invalidated one measurement. */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (!cold) {
    const warm = await ctx.newPage()
    await warm.goto(BASE, { waitUntil: 'load' }).catch(() => {})
    await warm.waitForTimeout(6000)
    await warm.close()
  }
  const page = await ctx.newPage()

  const tiles = { requested: 0, loaded: 0, errored: 0 }
  const errors = []
  let styleStatus = null
  let firstTileAt = null
  const t0 = Date.now()

  page.on('request', (r) => { if (isTile(r.url())) tiles.requested++ })
  page.on('requestfailed', (r) => { if (isTile(r.url())) tiles.errored++ })
  page.on('response', (r) => {
    const u = r.url()
    if (isStyle(u)) styleStatus = r.status()
    if (isTile(u)) {
      if (r.status() < 400) { tiles.loaded++; firstTileAt ??= Date.now() - t0 }
      else tiles.errored++
    }
  })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE, { waitUntil: 'load' })

  /* Wait for tiles to STOP arriving rather than for a fixed sleep — a fixed
     sleep either wastes time or truncates the measurement, and which one it did
     is invisible in the result. */
  let last = -1
  const deadline = Date.now() + BUDGET_MS
  while (Date.now() < deadline) {
    await page.waitForTimeout(500)
    if (tiles.loaded === last && tiles.loaded > 0) break
    last = tiles.loaded
  }

  /* WAIT for the style to settle rather than SAMPLING it. Read at an arbitrary
     instant, `isStyleLoaded()` disagreed with itself across identical runs —
     three failures one time, four the next — because raster and glyph sources
     are still settling after the vector tiles stop arriving. An assertion that
     can differ between two identical runs is a flake generator, and this suite
     exists to be believed. */
  /* WAIT FOR EXACTLY WHAT THE QUERY NEEDS, in one loop.
     Two earlier versions raced: the first broke out on `null` (handle not yet
     assigned) because `null !== false`; the second checked for the handle ONCE,
     which is the same race moved up a line. Both reported 0 extruded masses on
     a map that was drawing 13 — a red assertion pointing at the test, not the
     map, which is the most expensive kind of false alarm here.
     So: poll for the handle AND a settled style AND the layer being queried,
     and record which of them was missing if it times out. */
  let waited = null
  const readyDeadline = Date.now() + 15000
  while (Date.now() < readyDeadline) {
    waited = await page.evaluate(() => {
      const m = window.__cid_map
      if (!m) return { handle: false }
      return { handle: true, styleLoaded: m.isStyleLoaded() === true, layer: !!m.getLayer('rooms-fp') }
    })
    if (!waited.handle || (waited.styleLoaded && waited.layer)) break
    await page.waitForTimeout(400)
  }

  /* THE CONTAINER MEASUREMENT — the actual bug, read directly. */
  const geom = await page.evaluate(() => {
    const c = document.querySelector('canvas.maplibregl-canvas')
    const h = c?.parentElement?.parentElement
    return {
      canvas: c ? { w: c.clientWidth, h: c.clientHeight } : null,
      holder: h ? { w: h.clientWidth, h: h.clientHeight } : null,
    }
  })

  /* DID IT PAINT? A screenshot captures composited output, so this works
     without preserveDrawingBuffer. A blank map yields one flat colour; a drawn
     map yields many. Counting distinct colours distinguishes "rendered" from
     "dark rectangle where a dark map would be". */
  /* THE BUILDINGS, ASKED OF THE MAP rather than counted in the source file.
     lib/room-footprints.ts says 16 components carry a height; that is a claim
     about DATA. Whether 16 masses are actually on screen is a claim about
     RENDERING, and those came apart badly enough here to be worth separating. */
  const rendered = await page.evaluate(() => {
    const m = window.__cid_map
    if (!m) return null
    const q = (id) => { try { return m.queryRenderedFeatures({ layers: [id] }) } catch { return [] } }
    const ex = q('rooms-fp')
    return {
      extruded: new Set(ex.map((f) => `${f.properties.slug}/${f.properties.component}`)).size,
      flat: new Set(q('rooms-flat').map((f) => `${f.properties.slug}/${f.properties.component}`)).size,
      heights: [...new Set(ex.map((f) => f.properties.height))].sort((a, b) => b - a).slice(0, 3),
      styleLoaded: m.isStyleLoaded(),
    }
  })

  /* THE CONTAINER CHANGES WITHOUT THE WINDOW CHANGING — which is the only case
     the ResizeObserver exists for. Resizing the VIEWPORT proved nothing:
     MapLibre installs its own window-resize listener, so that assertion passed
     with the observer ablated. It was a test of the library, wearing the name
     of a test of our code.
     Widening the panel moves the map's container while the window holds still.
     Nothing but an observer catches that. */
  await page.evaluate(() => document.documentElement.style.setProperty('--cid-panel-w', '560px'))
  await page.waitForTimeout(1000)
  /* THE DRAWING BUFFER, not clientWidth. The canvas ELEMENT is styled 100%, so
     its clientWidth follows the container by CSS alone — that assertion passed
     with the observer ablated too, measuring the browser's layout engine rather
     than MapLibre's camera. `canvas.width` is the GL drawing buffer and only
     `map.resize()` changes it, so it is the one number that can tell the two
     apart. Third wrong observable in this investigation; the pattern is picking
     the number that is easy to read over the number that can be wrong. */
  const afterResize = await page.evaluate(() => {
    const c = document.querySelector('canvas.maplibregl-canvas')
    const h = c?.parentElement?.parentElement
    return {
      canvas: c?.width ?? 0,
      holder: Math.round((h?.clientWidth ?? 0) * window.devicePixelRatio),
    }
  })
  await page.evaluate(() => document.documentElement.style.removeProperty('--cid-panel-w'))
  await page.waitForTimeout(600)

  /* A MISSING CANVAS IS A RESULT, NOT A CRASH. This threw a 30s Playwright
     timeout and a stack trace when the map failed to mount — the one situation
     the probe exists to describe, reported as a tooling error. */
  const canvasEl = await page.$('canvas.maplibregl-canvas')
  const shot = canvasEl ? await canvasEl.screenshot() : Buffer.alloc(4)

  /* DOES THE FILTER DIM REACH EVERY LAYER THAT DRAWS THE MASS?
     Five layers draw a building and each carries its own paint block, so
     "the dim works" is only ever true of the ones somebody remembered. The CAP
     is the one that gets missed — it is added conditionally, it is the roof
     ring rather than the mass, and a dimmed building wearing a lit gold roof
     still reads as selected. So the check enumerates layers from the live map
     rather than trusting a list written alongside the code. */
  const dimWiring = await page.evaluate(() => {
    const m = window.__cid_map
    if (!m) return null
    const COLOUR = {
      'rooms-flat': 'fill-color',
      'rooms-fp': 'fill-extrusion-color',
      'rooms-edge': 'line-color',
      'rooms-cap': 'fill-extrusion-color',
      'rooms-shell': 'fill-extrusion-color',
    }
    const out = { present: [], missing: [], hoverBeforeDim: [] }
    for (const [id, prop] of Object.entries(COLOUR)) {
      if (!m.getLayer(id)) continue
      const expr = JSON.stringify(m.getPaintProperty(id, prop) ?? null)
      if (!expr.includes('"dim"')) { out.missing.push(id); continue }
      out.present.push(id)
      /* DIM MUST BE TESTED FIRST. The precedence is decided by expression
         ORDER, so this asserts the decision rather than the symptom. */
      if (expr.indexOf('"hover"') !== -1 && expr.indexOf('"hover"') < expr.indexOf('"dim"')) {
        out.hoverBeforeDim.push(id)
      }
    }
    const impl = m.style?._layers?.['rooms-wire']?.implementation
    out.wireHasSetDimmed = typeof impl?.setDimmed === 'function'
    return out
  })

  /* And BEHAVIOURALLY: dim a real slug and confirm the picture moves. An
     expression that mentions `dim` and never resolves to it would pass the
     check above and change nothing on screen. */
  let dimPixels = null
  if (canvasEl && dimWiring) {
    /* STOP THE DRIFT FIRST. The first version compared two screenshots while
       the ambient camera was still turning, so 112,852 pixels "moved" for
       dimming one building — about half the canvas. That assertion would have
       passed with the dim doing nothing at all: it was measuring the orbit. */
    await page.evaluate(() => window.__cid_map.getCanvasContainer()
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    /* Then wait for the map to say it is DONE, not for a guessed interval:
       tiles still arriving repaint the frame and show up as movement. */
    await page.evaluate(() => new Promise((res) => {
      const m = window.__cid_map
      if (m.loaded() && m.areTilesLoaded()) return res(null)
      m.once('idle', () => res(null))
      setTimeout(() => res(null), 8000)
    }))
    await page.waitForTimeout(1200)

    /* EXCLUDE THE BOTTOM STRIP. The debug badge reprints "frame Nms ago" twice
       a second and sits over the canvas, so it landed in the screenshot and
       read as 388 pixels of movement on a map whose camera had not moved at
       all — the instrument showing up in its own measurement. */
    const BADGE_H = 80
    const diff = (a, b) => {
      let n = 0
      const rows = Math.min(a.h, b.h) - BADGE_H
      for (let y = 0; y < rows; y += 2) {
        for (let x = 0; x < Math.min(a.w, b.w); x += 2) {
          const i = (y * a.w + x) * a.nc
          const j = (y * b.w + x) * b.nc
          if (Math.abs(a.px[i] - b.px[j]) + Math.abs(a.px[i + 1] - b.px[j + 1]) > 8) n++
        }
      }
      return n
    }
    /* CONTROL: two frames with nothing changed. Whatever this reads is the
       noise floor, and the dim has to beat it by a wide margin to mean
       anything. */
    const lit = decodePng(await canvasEl.screenshot())
    await page.waitForTimeout(600)
    const stillLit = decodePng(await canvasEl.screenshot())
    const noise = diff(lit, stillLit)
    const before = countGold(shot)
    await page.evaluate(() => {
      const m = window.__cid_map
      const feats = m.querySourceFeatures('fp')
      const slug = feats.find((f) => f.properties.height)?.properties.slug
      for (const src of ['fp', 'shells', 'roofs']) {
        if (!m.getSource(src)) continue
        for (const f of m.querySourceFeatures(src)) {
          if (f.properties.slug === slug) m.setFeatureState({ source: src, id: f.id }, { dim: true })
        }
      }
      const impl = m.style?._layers?.['rooms-wire']?.implementation
      impl?.setDimmed?.(new Set([slug]))
      m.triggerRepaint()
      window.__cid_dimmed = slug
    })
    await page.waitForTimeout(900)
    const after = decodePng(await canvasEl.screenshot())
    dimPixels = {
      moved: diff(lit, after),
      noise,
      goldBefore: before,
      goldAfter: countGold(await canvasEl.screenshot()),
    }
  }

  /* DOES THE WIREFRAME REACH THE SCREEN?
     It once reported 848 segments, 274 rendered frames and GL error 0 while
     drawing nothing at all — every number true, every one about the buffer and
     none about the pixels. So this removes the layer and re-measures: the only
     evidence that counts is that the canvas CHANGES when it goes away. */
  let wire = null
  if (canvasEl && await page.evaluate(() => !!window.__cid_map?.getLayer?.('rooms-wire'))) {
    const before = countGold(shot)
    const segments = await page.evaluate(() =>
      window.__cid_map.style?._layers?.['rooms-wire']?.implementation?.segments ?? 0)
    await page.evaluate(() => window.__cid_map.removeLayer('rooms-wire'))
    await page.waitForTimeout(900)
    const after = countGold(await canvasEl.screenshot())
    wire = {
      segments,
      goldWith: before,
      goldWithout: after,
      delta: +(before - after).toFixed(3),
    }
  }
  const colours = new Set()
  for (let i = 0; i < shot.length - 3; i += 997) colours.add(shot.readUInt32BE(i))

  await ctx.close()
  return { tiles, styleStatus, errors, geom, firstTileAt, distinctBytes: colours.size, rendered, afterResize, shot, hues: hueShare(shot), wire, dimWiring, dimPixels }
}

const browser = await chromium.launch()
const results = []
for (let i = 0; i < RUNS; i++) {
  for (const cold of RUNS > 1 ? [true, false] : [true]) {
    results.push({ cold, ...(await probe(browser, { cold })) })
  }
}
await browser.close()

let failed = 0
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++ }

for (const [i, r] of results.entries()) {
  console.log(`\n=== run ${i + 1} — ${r.cold ? 'COLD cache' : 'WARM cache'} ===`)
  console.log(`  holder      ${r.geom.holder ? `${r.geom.holder.w}x${r.geom.holder.h}` : 'ABSENT'}`)
  console.log(`  canvas      ${r.geom.canvas ? `${r.geom.canvas.w}x${r.geom.canvas.h}` : 'ABSENT'}`)
  console.log(`  style       ${r.styleStatus ?? 'NOT REQUESTED'}`)
  console.log(`  tiles       requested ${r.tiles.requested} · loaded ${r.tiles.loaded} · errored ${r.tiles.errored}`)
  console.log(`  first tile  ${r.firstTileAt === null ? 'NEVER' : `${r.firstTileAt}ms`}`)
  console.log(`  console     ${r.errors.length} error(s)${r.errors.length ? `: ${r.errors[0].slice(0, 90)}` : ''}`)
  console.log(`  HUE SHARE   ${Object.entries(r.hues).filter(([, v]) => v > 0.01).map(([k, v]) => `${k} ${v}%`).join(' · ')}`)

  ok(r.geom.canvas && r.geom.canvas.w > 0 && r.geom.canvas.h > 0, 'the map has a viewport (canvas is not 0x0)')
  ok(r.styleStatus === 200, 'the style loaded')
  ok(r.tiles.requested > 0, 'THE MAP REQUESTED TILES — the observable that was zero')
  ok(r.tiles.loaded > 0, 'tiles came back')
  ok(r.tiles.errored === 0, 'no tile request failed')
  /* THRESHOLD FROM BOTH OBSERVED STATES, not from a guess. At `> 8` this
     assertion PASSED during the dead-worker regression it was written to catch:
     an undrawn canvas still samples ~18 distinct values from the background and
     panel edges, where a drawn map gives ~974. A threshold nothing fails is a
     line in a log, not a test. */
  ok(r.distinctBytes > 200,
    `the canvas actually painted (${r.distinctBytes} distinct samples; drawn ~974, blank ~18)`)
  ok(r.errors.length === 0, 'no console errors')
  ok(r.afterResize.canvas === r.afterResize.holder,
    `the canvas tracks a CONTAINER-ONLY resize (${r.afterResize.canvas} vs holder ${r.afterResize.holder})`)
  if (r.dimWiring) {
    console.log(`  dim wiring  ${r.dimWiring.present.join(', ')}`
      + `${r.dimWiring.missing.length ? ` · MISSING ${r.dimWiring.missing.join(', ')}` : ''}`)
    ok(r.dimWiring.missing.length === 0,
      `every layer that draws the mass answers the filter dim${r.dimWiring.missing.length ? ` — ${r.dimWiring.missing.join(', ')} does not` : ''}`)
    ok(r.dimWiring.present.includes('rooms-cap'),
      'the CAP layer is wired — the roof ring is the one that gets missed')
    ok(r.dimWiring.hoverBeforeDim.length === 0,
      `dim is tested before hover everywhere, so hovering cannot retract the filter${r.dimWiring.hoverBeforeDim.length ? ` — ${r.dimWiring.hoverBeforeDim.join(', ')}` : ''}`)
    ok(r.dimWiring.wireHasSetDimmed, 'the wireframe accepts a dim set (it cannot read feature-state)')
  }
  if (r.dimPixels) {
    console.log(`  dim effect  ${r.dimPixels.moved} sampled pixels moved · still-frame noise ${r.dimPixels.noise}`
      + ` · gold ${r.dimPixels.goldBefore}% -> ${r.dimPixels.goldAfter}%`)
    ok(r.dimPixels.noise < 200,
      `the camera is STILL for this measurement (noise floor ${r.dimPixels.noise})`)
    ok(r.dimPixels.moved > Math.max(200, r.dimPixels.noise * 10),
      `dimming a room CHANGES THE PICTURE — ${r.dimPixels.moved} pixels against a ${r.dimPixels.noise} noise floor`)
  }
  if (r.wire) {
    console.log(`  wireframe   ${r.wire.segments} segments · gold ${r.wire.goldWith}% with, ${r.wire.goldWithout}% without`)
    ok(r.wire.delta > 0.02,
      `THE WIREFRAME PAINTS PIXELS — removing it changes the canvas by ${r.wire.delta}pp of gold`)
  }
  if (r.rendered) {
    console.log(`  extruded    ${r.rendered.extruded} masses on screen · tallest ${r.rendered.heights.join(', ')}m`)
    console.log(`  flat        ${r.rendered.flat} masses`)
    ok(r.rendered.extruded > 0,
      `the sourced buildings are RENDERED, not merely in the data (${r.rendered.extruded}`
      + `${r.rendered.extruded === 0 ? `; styleLoaded=${r.rendered.styleLoaded}` : ''})`)
    ok(r.rendered.styleLoaded, 'the style reports itself fully loaded')
  } else {
    console.log('  (build with NEXT_PUBLIC_MAP_DEBUG=1 for the rendered-feature assertions)')
  }
}

if (RUNS > 1) {
  const avg = (f) => results.filter(f).reduce((a, r) => a + (r.firstTileAt ?? 0), 0) / results.filter(f).length
  console.log(`\n  cold first-tile avg  ${avg((r) => r.cold).toFixed(0)}ms  (n=${results.filter((r) => r.cold).length})`)
  console.log(`  warm first-tile avg  ${avg((r) => !r.cold).toFixed(0)}ms  (n=${results.filter((r) => !r.cold).length})`)
}

if (process.env.MAP_PROBE_SHOT) {
  /* VERIFY THE FILE LANDED. A screenshot was reported as saved seven times
     without once checking, and the path being cited was a session temp
     directory nobody else could reach — the same shape as a push that pushed
     nothing and still printed "pushed". */
  const path = process.env.MAP_PROBE_SHOT
  writeFileSync(path, results[0].shot)
  const size = statSync(path).size
  if (size < 1000) {
    console.log(`\n  SCREENSHOT FAILED — ${path} is ${size} bytes`)
    failed++
  } else {
    console.log(`\n  screenshot -> ${path} (${(size / 1024).toFixed(0)} KB, verified on disk)`)
  }
}

console.log(failed ? `\n${failed} FAILURES` : '\nMap probe passed — observed, not inferred.')
process.exit(failed ? 1 : 0)
