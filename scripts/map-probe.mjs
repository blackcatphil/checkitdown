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
 *   node scripts/map-probe.mjs [url]        # default http://localhost:3100
 *   MAP_PROBE_RUNS=3 node scripts/map-probe.mjs   # cold/warm timing, n>1
 *
 * THE HOSTNAME IS LOAD-BEARING — it must match what `next dev` bound, and
 * `localhost` is NOT `127.0.0.1` to an origin check. Next 16 blocks
 * cross-origin requests to dev-only assets, and the two spellings are different
 * origins, so browsing the same server by IP makes it **403 its own chunks**.
 * The page still returns 200, the HTML still contains the map holder, and the
 * only visible symptom is that client JS never boots: no canvas, no MapLibre,
 * no error page. This probe then crashed inside a PNG decoder, because the
 * no-canvas fallback is a 4-byte placeholder that cannot be inflated —
 * a stack trace about zlib for a problem that was a hostname.
 *
 * Diagnosed 2026-08-07 by noticing the chunk 403'd to the browser and 200'd to
 * curl. `curl` sends no `Origin`, so it is exempt from the very check that was
 * failing — THE TOOL THAT SAID "the file is fine" WAS THE ONE TOOL THAT COULD
 * NOT SEE THE BUG. If a dev asset 404s or 403s only in the browser, suspect the
 * origin before the file. (`allowedDevOrigins` in `next.config.ts` is the
 * supported way to widen this; matching the hostname is simpler and needs no
 * production-facing config change.)
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

/* `localhost`, not `127.0.0.1` — see the origin note in the header. */
const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3100'
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
  /* ...and the placeholder had to go too. The guard above stopped the Playwright
     timeout, but a 4-byte stand-in still reached `decodePng`, so the run died on
     `Z_BUF_ERROR: unexpected end of file` from zlib — a crash, wearing a
     different stack trace. Every measurement below reads pixels; without a
     canvas there is nothing to be wrong about, so say the one true thing and
     stop. */
  if (!canvasEl) {
    const holder = await page.evaluate(() => {
      const el = document.querySelector('[data-map-holder], .maplibregl-map')
      return el ? `${el.clientWidth}x${el.clientHeight}` : 'holder not in the DOM either'
    })
    console.error(`\nNO MAP CANVAS at ${BASE} — MapLibre never constructed.`)
    console.error(`  holder: ${holder}`)
    console.error(`  console errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`)
    console.error(`  style: ${styleStatus ?? 'never requested'} · tiles requested: ${tiles.requested}`)
    console.error('\n  If the page itself returns 200, check the ORIGIN before the code:')
    console.error('  Next 16 403s dev-only chunks for a hostname it was not started on,')
    console.error('  and `localhost` and `127.0.0.1` are different origins. Client JS then')
    console.error('  never boots and there is no error page to notice.')
    await ctx.close()
    process.exit(1)
  }
  const shot = await canvasEl.screenshot()

  /* NO ROOM IS UNREACHABLE AT ANY ZOOM.
     The locator dot is dropped above MASS_ZOOM for rooms that have a mass, so
     "the dot went away" and "the room became unclickable" now look identical
     from outside. This checks the property that actually matters, at BOTH
     cameras: for each of the 17 rooms, is there something on screen that opens
     it — a pin, a cluster containing it, or its own building. */
  const reach = await page.evaluate(async () => {
    const m = window.__cid_map
    if (!m) return null
    const settle = () => new Promise((r) => { m.once('idle', r); setTimeout(r, 4000) })
    const MASS = ['rooms-hit', 'rooms-flat', 'rooms-fp']
    const out = {}
    for (const [name, cam] of [
      ['valley', { center: [-115.1709, 36.1309], zoom: 10, pitch: 0, bearing: 0 }],
      ['strip', { center: [-115.1726, 36.112], zoom: 14.5, pitch: 52, bearing: -18 }],
    ]) {
      m.jumpTo(cam)
      await settle()
      const pins = new Set(m.queryRenderedFeatures({ layers: ['pin'] }).map((f) => f.properties.slug))
      const clustered = m.queryRenderedFeatures({ layers: ['clusters'] })
        .reduce((n, f) => n + (f.properties.point_count ?? 0), 0)
      const mass = new Set(
        MASS.filter((l) => m.getLayer(l))
          .flatMap((l) => m.queryRenderedFeatures({ layers: [l] }))
          .map((f) => f.properties.slug),
      )
      /* THE PROPERTY, STATED EXACTLY: every room whose marker is inside the
         viewport must have something on screen that opens it. Counting totals
         hid Orleans — 7 masses and 8 rooms in view still "passed" a >0 check
         while one room had nothing at all. */
      /* IN VIEW MEANS ON THE SCREEN. `getBounds().contains()` is a lng/lat
         rectangle, and at pitch 52 that rectangle reaches far outside the
         frame: it called Orleans "in view" while the room projects to x=-465,
         465px off the left edge. The probe then reported an unreachable room
         for three iterations while the map was behaving correctly — a test
         asserting something the user cannot see. */
      const canvas = m.getCanvas()
      const W = canvas.clientWidth, H = canvas.clientHeight
      const inView = [...new Set(
        m.querySourceFeatures('rooms')
          .filter((f) => {
            const p = m.project(f.geometry.coordinates)
            return p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H
          })
          .map((f) => f.properties.slug),
      )]
      const clusterCovers = clustered > 0
      out[name] = {
        zoom: m.getZoom(),
        pins: [...pins],
        mass: [...mass],
        clustered,
        inView: inView.length,
        unreachable: clusterCovers ? [] : inView.filter((s) => !pins.has(s) && !mass.has(s)),
      }
    }
    /* Put the camera back: the assertions after this one measure the landing
       view, and leaving it parked somewhere else made styleLoaded read as
       false on a map that was merely still settling. */
    m.jumpTo({ center: [-115.1726, 36.112], zoom: 14.5, pitch: 52, bearing: -18 })
    await settle()
    return out
  })

  /* THE HIT FLOOR. The smallest footprint on screen at the landing camera is
     the room that got harder to reach — measured, not assumed. */
  const hitFloor = await page.evaluate(() => {
    const m = window.__cid_map
    if (!m || !m.getLayer('rooms-flat')) return null
    m.jumpTo({ center: [-115.1726, 36.112], zoom: 14.5, pitch: 52, bearing: -18 })
    const seen = new Map()
    for (const l of ['rooms-flat', 'rooms-fp']) {
      for (const f of m.queryRenderedFeatures({ layers: [l] })) {
        const ring = f.geometry?.coordinates?.[0]
        if (!ring) continue
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
        for (const c of ring) {
          const p = m.project(c)
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
        }
        const px = Math.min(maxX - minX, maxY - minY)
        const slug = f.properties.slug
        if (!seen.has(slug) || px > seen.get(slug)) seen.set(slug, px)
      }
    }
    const rows = [...seen].sort((a, b) => a[1] - b[1])
    return { smallest: rows[0], all: rows.slice(0, 4) }
  })

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
  let styleSettled = null
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
    /* STYLE-LOADED, READ FROM A SETTLED MAP.
       This used to be sampled in the `rendered` block above, which runs while
       the ambient drift is still turning the camera — and `isStyleLoaded()` is
       false whenever ANY source is loading, so a continuously-moving camera
       makes it flicker. Measured: 88% true while drifting, 100% true once
       stopped and idle. That is the "styleLoaded flake" — one run in eight,
       an intermittent gate everyone learns to re-run.
       Here the drift is already stopped and the map already idle, so the
       question is "does the style finish loading" rather than "was a tile in
       flight at this instant". */
    styleSettled = await page.evaluate(() => window.__cid_map.isStyleLoaded() === true)

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
  /* THE THIRD FILTER STATE, MEASURED ON COMPOSITED PIXELS.
     The amenity filter has three answers — match, confirmed absent, and never
     checked — and only the first two have ever had a colour. A neutral pin that
     silently renders as a dim one would restore exactly the confusion the state
     was added to remove, and no token test can see it: every mass layer paints
     at fill-opacity 0.55 over a dark ground, so what reaches the screen is
     nowhere near the token. Matching the three hexes directly was tried and
     reported all three states missing on a map where all three were present.
     So this drives the real control and compares two real frames. */
  let threeState = null
  const amenBtn = await page.$('aside button.cid-check:has-text("Free self-park")')
  if (canvasEl && amenBtn) {
    const chroma = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b)
    /* Its own copy: the dim measurement's BADGE_H is scoped to that block, and
       borrowing it silently across scopes is how this crashed once already. The
       debug badge repaints twice a second and would read as movement. */
    const BADGE = 80
    const before = decodePng(await canvasEl.screenshot())
    await amenBtn.click()
    await page.waitForTimeout(2200)
    const after = decodePng(await canvasEl.screenshot())
    const { w, h, nc } = before
    let neutral = 0, coloured = 0, lit = 0
    const nSum = [0, 0, 0]
    for (let y = 0; y < h - BADGE; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * nc
      const ar = before.px[i], ag = before.px[i + 1], ab = before.px[i + 2]
      const br = after.px[i], bg = after.px[i + 1], bb = after.px[i + 2]
      if (0.2126 * ar + 0.7152 * ag + 0.0722 * ab < 40) continue
      const moved = Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb))
      if (moved <= 6) { if (chroma(br, bg, bb) >= 14) lit++; continue }
      if (chroma(br, bg, bb) <= 8) { neutral++; nSum[0] += br; nSum[1] += bg; nSum[2] += bb }
      else coloured++
    }
    const summary = (await page.$eval('aside p.num', (el) => el.textContent) ?? '').trim()
    threeState = {
      neutral, coloured, lit, summary,
      neutralChroma: neutral ? chroma(...nSum.map((v) => Math.round(v / neutral))) : null,
    }
    await amenBtn.click()
    await page.waitForTimeout(600)
  }

  const colours = new Set()
  for (let i = 0; i < shot.length - 3; i += 997) colours.add(shot.readUInt32BE(i))

  await ctx.close()
  return { tiles, styleStatus, errors, geom, firstTileAt, distinctBytes: colours.size, rendered, afterResize, shot, hues: hueShare(shot), wire, dimWiring, dimPixels, reach, hitFloor, styleSettled, threeState }
}

const browser = await chromium.launch()
const results = []
for (let i = 0; i < RUNS; i++) {
  for (const cold of RUNS > 1 ? [true, false] : [true]) {
    results.push({ cold, ...(await probe(browser, { cold })) })
  }
}
/* Collected before the browser closes; reported with everything else below,
   because `ok` is defined after the teardown in this file. */
const preFindings = []
const skipped = []
const pre = (cond, msg) => preFindings.push([cond, msg])

/* ═══ THE (VARIANT, STAKES) FILTERS — 2026-08-09 ═══
   Asserted in the browser as well as in lib/stakes-filter.test.mjs, because the
   unit test proves the MATCHER and this proves the PANEL is wired to it. A
   correct matcher behind a checkbox that toggles the wrong key is still wrong.

   THE NAMED COUNTER-EXAMPLE runs here too: ARIA spreads $1/2 PLO and no $1/2
   NLH, so checking "$1/2" under NO-LIMIT must leave ARIA dimmed while Golden
   Nugget stays lit. Bellagio is the positive control on $2/5 PLO. */
{
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page2.goto(BASE, { waitUntil: 'networkidle' })
  await page2.waitForFunction(() => typeof window.__cid_map !== 'undefined', null, { timeout: 12000 }).catch(() => {})
  await page2.waitForTimeout(2500)

  /* THE DEFAULT, ASSERTED — measured, not assumed. All groups open is 2500px
     of scrollHeight against 836px of desktop panel; collapsing the five stakes
     sub-heads takes it to 1122px. The GAMES and amenity groups stay open
     because they are short and coarse — the overflow was never theirs. */
  const defaults = await page2.evaluate(() => {
    const panel = document.querySelector('.cid-mappanel')
    return [...panel.querySelectorAll('.cid-disclose')].map((b) => ({
      label: b.querySelector('span')?.textContent.trim(),
      open: b.getAttribute('aria-expanded') === 'true',
      h: Math.round(b.getBoundingClientRect().height),
    }))
  })
  pre(defaults.filter((d) => !d.open).length === 5,
    `the five stakes sub-heads ship COLLAPSED (${defaults.filter((d) => !d.open).length} closed of ${defaults.length})`)
  pre(defaults.every((d) => d.h >= 44),
    `every disclosure head is a 44px target (min ${Math.min(...defaults.map((d) => d.h))}px)`)

  const shape = await page2.evaluate(async () => {
    const root = document.querySelector('.cid-stakes')
    if (!root) return null
    /* THE SUB-HEADS SHIP COLLAPSED (2026-08-09), so the boxes are not in the
       DOM until they are opened — `{open && children}` unmounts them rather
       than hiding them, which is what makes the checked state survive a
       collapse: it lives in MapShell, not in the markup. These assertions are
       about the CATALOGUE being complete, not about what a first-time reader
       sees, so open every group before counting. The default state is asserted
       separately, below. */
    for (const btn of root.querySelectorAll('.cid-disclose')) {
      if (btn.getAttribute('aria-expanded') === 'false') btn.click()
    }
    await new Promise((r) => setTimeout(r, 500))
    const heads = [...root.querySelectorAll('.cid-subhead')].map((e) => e.textContent.trim())
    const boxes = [...root.querySelectorAll('.cid-check')].map((b) => ({
      label: b.children[1]?.textContent.trim(),
      count: Number(b.children[2]?.textContent.trim()),
    }))
    return { heads, boxes }
  })
  pre(shape != null, 'the STAKES group renders')
  if (shape) {
    pre(shape.boxes.length === 26, `all 26 (variant, stakes) combos render as checkboxes (${shape.boxes.length})`)
    pre(shape.heads.length === 5, `five variant sub-heads (${shape.heads.length}: ${shape.heads.join(' / ')})`)
    /* OMAHA IS UNMERGED, by ruling. Three spellings, six combos, shown as
       stored — GVR's bare "Omaha" is a floor question, not a UI merge. */
    const omaha = shape.boxes.filter((b) => /Omaha/.test(b.label))
    pre(omaha.length === 6, `Omaha stays unmerged — 6 combos under OTHER (${omaha.length})`)
    /* Counts are ROW-LEVEL. $1/2 NLH is spread by 8 rooms; ARIA is not one. */
    const half = shape.boxes.find((b) => b.label === '$1/2')
    /* 6 since the 2026-08-09 partner apply: Golden Nugget and South Point were
       recorded as spreading $1/2 and the floor visit corrected both to $1/3.
       The number is the point of the assertion — it is row-level, so it counts
       rooms that spread THIS stakes at THIS variant — so it moves when the
       data does, and pinning it is what caught the change. */
    pre(half != null && half.count === 6, `$1/2 NLH counts 6 rooms, row-level (${half ? half.count : 'missing'})`)
  }

  /* ═══ THE FEATURE-STATE HALF NEEDS THE FLAG-GATED HANDLE ═══
     `window.__cid_map` exists only under NEXT_PUBLIC_MAP_DEBUG=1, and CI
     deliberately probes the SHIPPING configuration — no handle. Reading it
     directly made these two the only assertions in this file that THROW
     instead of degrading, which took main red.

     They now report a named SKIP, exactly as the rendered-feature assertions
     above do. That is honest rather than a hole because the same counter-example
     and control run UNCONDITIONALLY at the unit level in
     lib/stakes-filter.test.mjs — the coverage does not depend on this flag; only
     the browser-level confirmation of the wiring does.

     The DOM-shape assertions above need no handle and keep running in CI. */
  /* ═══ THE COLLAPSED-FILTER TRAP — 2026-08-09 ═══
     A collapsed group whose boxes are still checked filters the map INVISIBLY:
     a dimmed city and no visible reason for it, which is the same failure class
     as a bare "1 room skipped". Two rules answer it and both are asserted here,
     BY NAME, and both run in CI — neither needs the debug handle, because the
     dim state is compared as PIXELS rather than read from feature-state. */
  const trap = await page2.evaluate(async () => {
    const panel = document.querySelector('.cid-mappanel')
    const heads = [...panel.querySelectorAll('.cid-disclose')]
    const nlh = heads.find((h) => /NO-LIMIT/.test(h.textContent))
    if (!nlh) return { err: 'no NLH disclosure head' }
    if (nlh.getAttribute('aria-expanded') === 'false') { nlh.click(); await new Promise((r) => setTimeout(r, 400)) }
    /* Check two boxes inside it, so the group is genuinely filtering. */
    const boxes = [...nlh.parentElement.querySelectorAll('.cid-check')].slice(0, 2)
    for (const b of boxes) { b.click(); await new Promise((r) => setTimeout(r, 350)) }
    await new Promise((r) => setTimeout(r, 900))
    const canvas = document.querySelector('canvas')
    const before = canvas.toDataURL('image/png')
    const summaryBefore = panel.querySelector('.cid-sheet-handle')?.textContent ?? ''
    /* Now collapse it WITH the checks active. */
    nlh.click()
    await new Promise((r) => setTimeout(r, 1100))
    const after = canvas.toDataURL('image/png')
    return {
      expanded: nlh.getAttribute('aria-expanded'),
      headText: nlh.textContent.trim(),
      checkedCount: boxes.length,
      dimUnchanged: before === after,
      summaryBefore,
      summaryAfter: panel.querySelector('.cid-sheet-handle')?.textContent ?? '',
    }
  })
  if (trap.err) {
    pre(false, `the collapsed-filter trap could not be exercised — ${trap.err}`)
  } else {
    pre(trap.expanded === 'false', `a group with active checks CAN be collapsed (aria-expanded=${trap.expanded})`)
    /* RULE 1: COLLAPSING NEVER CLEARS A SELECTION. Compared as rendered pixels,
       so this cannot pass by reading a variable that agrees with itself. */
    pre(trap.dimUnchanged === true,
      `THE TRAP, rule 1: collapsing a filtering group leaves the map's dim state byte-identical (${trap.dimUnchanged ? 'identical' : 'CHANGED — the collapse cleared a filter'})`)
    /* RULE 2: THE COLLAPSED HEAD CARRIES ITS COUNT. */
    pre(/\d+ selected/.test(trap.headText),
      `THE TRAP, rule 2: the collapsed head reports its active count ("${trap.headText.replace(/\s+/g, ' ')}")`)
    pre(new RegExp(`${trap.checkedCount} selected`).test(trap.headText),
      `...and the count is the right one (${trap.checkedCount} checked)`)
  }

  const hasHandle2 = await page2.evaluate(() => typeof window.__cid_map !== 'undefined')
  if (!hasHandle2) {
    skipped.push('THE COUNTER-EXAMPLE: ARIA must not match $1/2 NLH — needs NEXT_PUBLIC_MAP_DEBUG=1 (asserted unconditionally in lib/stakes-filter.test.mjs)')
    skipped.push('THE CONTROL: Bellagio matches $2/5 PLO — same flag, same unit-level cover')
  } else {
    const verdict = await page2.evaluate(async () => {
      const root = document.querySelector('.cid-stakes')
      const box = [...root.querySelectorAll('.cid-check')].find((b) => b.children[1]?.textContent.trim() === '$1/2')
      if (!box) return { err: 'no $1/2 checkbox' }
      box.click()
      await new Promise((r) => setTimeout(r, 900))
      const seen = {}
      for (const f of window.__cid_map.querySourceFeatures('rooms')) {
        const sl = f.properties.slug
        if (sl === 'aria' && !(sl in seen)) seen[sl] = f.properties.hit
      }
      return seen
    })
    pre(verdict.aria === 0,
      `THE COUNTER-EXAMPLE: ARIA spreads $1/2 PLO, so $1/2 NLH must NOT match it (hit=${verdict.aria})`)

    /* THE CONTROL IS BELLAGIO, not Golden Nugget: a control has to be VISIBLE
       at the camera the probe is at. Golden Nugget is downtown, outside the
       Strip entry frame, so `querySourceFeatures` never returned it and the
       assertion read `hit=undefined` — a control that is absent proves nothing.
       Bellagio is on the Strip and genuinely spreads $2/5 PLO. */
    const control = await page2.evaluate(async () => {
      const root = document.querySelector('.cid-stakes')
      const boxes = [...root.querySelectorAll('.cid-check')]
      boxes.find((b) => b.children[1]?.textContent.trim() === '$1/2')?.click()
      await new Promise((r) => setTimeout(r, 400))
      boxes.find((b) => b.children[1]?.textContent.trim() === '$2/5 PLO')?.click()
      await new Promise((r) => setTimeout(r, 900))
      for (const f of window.__cid_map.querySourceFeatures('rooms')) {
        if (f.properties.slug === 'bellagio') return f.properties.hit
      }
      return undefined
    })
    pre(control === 1, `THE CONTROL: Bellagio does spread $2/5 PLO and matches (hit=${control})`)
  }
  await page2.close()
}


await browser.close()

let failed = 0
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++ }
for (const [c, m] of preFindings) ok(c, m)
for (const m of skipped) console.log(`  SKIP  ${m}`)

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
  if (r.reach) {
    const v = r.reach.valley, t = r.reach.strip
    console.log(`  valley z${v.zoom.toFixed(1)}  pins ${v.pins.length} · masses ${v.mass.length} · clustered ${v.clustered}`)
    console.log(`  strip  z${t.zoom.toFixed(1)}  pins ${t.pins.length} · masses ${t.mass.length} · clustered ${t.clustered}`)
    ok(v.unreachable.length === 0,
      `no room is unreachable at the VALLEY camera${v.unreachable.length ? ` — ${v.unreachable.join(', ')}` : ''}`)
    ok(t.unreachable.length === 0,
      `no room is unreachable at the STRIP camera${t.unreachable.length ? ` — ${t.unreachable.join(', ')}` : ''}`)
    ok(t.mass.length > 0, 'the buildings are the target at the Strip camera')
    ok(v.mass.length === 0, 'no mass draws at the valley camera, so the dot must carry it there')
    ok(v.pins.length + v.clustered >= 17, `the valley view still accounts for all 17 rooms (${v.pins.length} pins + ${v.clustered} clustered)`)
  }
  if (r.hitFloor?.smallest) {
    const [slug, px] = r.hitFloor.smallest
    console.log(`  hit floor   smallest footprint at landing: ${slug} ${px.toFixed(1)}px`
      + ` (padded to ~${(px + 32).toFixed(0)}px by the 16px hit stroke)`)
    ok(px + 32 >= 14, `the smallest mass is not a worse target than the 7px dot (${(px + 32).toFixed(0)}px vs 14px)`)
  }
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
    ok(r.styleSettled !== false,
      'the style fully loads (read once the camera is still, not mid-drift)')
  } else {
    console.log('  (build with NEXT_PUBLIC_MAP_DEBUG=1 for the rendered-feature assertions)')
  }

  if (r.threeState) {
    const t = r.threeState
    console.log(`  amenity     "${t.summary}"`)
    console.log(`  three-state ${t.lit} lit · ${t.coloured} dimmed · ${t.neutral} neutral (chroma ${t.neutralChroma})`)
    /* The panel says three numbers; the map must show three states. Asserting
       the summary STRING as well as the pixels is deliberate — a filter that
       paints correctly while reporting "13 rooms match" has still told the
       reader the untrue thing. */
    ok(/not yet checked/.test(t.summary),
      `the panel names the unchecked rooms rather than absorbing them ("${t.summary}")`)
    ok(t.neutral > 200, `the UNKNOWN state PAINTS — ${t.neutral} px turned neutral`)
    ok(t.coloured > 200, `the ABSENT state paints separately — ${t.coloured} px dimmed`)
    ok(t.lit > 200, `matching rooms are left lit — ${t.lit} px unchanged`)
    ok(t.neutralChroma != null && t.neutralChroma <= 8,
      `unknown is genuinely neutral (chroma ${t.neutralChroma} <= 8), so it cannot be read as a dim`)
  } else {
    console.log('  (no amenity control found — the three-state assertions did not run)')
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
