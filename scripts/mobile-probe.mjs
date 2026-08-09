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

import { stageDescription, unstageDescription } from './stage-description.mjs'

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3100'
const CPU_THROTTLE = Number(process.env.MOBILE_PROBE_CPU ?? 4)

/* 390x844 is the iPhone 12/13/14/15 viewport and the most common phone size in
   the wild. DPR 3 is deliberate: it triples the pixels the GPU actually fills,
   which is the cost a CSS-pixel measurement hides. */
const PHONE = { width: 390, height: 844 }

let failed = 0
let skipped = 0
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++ }
/** Named, counted, and never silent — see the note beside MAP_DEBUG below. */
const skip = (msg, why) => { console.log(`  SKIP  ${msg} — ${why}`); skipped++ }

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: PHONE,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()

/* CONSOLE ERRORS ARE A GATE NOW, AND HYDRATION ERRORS FAIL IT.
   The device showed a hydration overlay while every probe stayed green,
   because no probe had ever read the console — a class of failure that is
   loud in the browser and invisible here. React logs a hydration mismatch as
   a console error, so capturing them is the whole fix. */
const consoleErrors = []
const DEV_NOISE = /_next\/hmr|websocket|hot-update|GL Driver Message|Download the React DevTools/i
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (!DEV_NOISE.test(t)) consoleErrors.push(t)
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

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

/**
 * THE MAP MEASUREMENTS NEED `window.__cid_map`, WHICH IS FLAG-GATED.
 *
 * It is exposed only under `NEXT_PUBLIC_MAP_DEBUG=1`. Without it every camera
 * reading here is `undefined.getZoom()` — the first version simply threw, which
 * is the worst outcome: a suite that dies looks identical to a suite that found
 * something.
 *
 * `map-probe.mjs` already solved this — it prints a line naming what was
 * skipped and lowers its CI floor with the reason beside the number — so this
 * does the same. What it must NOT do is skip everything: the FIVE-SURFACE
 * checks (overflow, tap targets, cards, the rank qualifier) need no handle at
 * all, and they are the assertions that caught the 494px header. Those run in
 * every configuration.
 */
/* WAIT FOR THE CANVAS FIRST, in every configuration. MapShell is a dynamic
   `ssr:false` import, so immediately after `load` there is no canvas yet and no
   handle either — reading either one at that moment reports "none" for a map
   that is merely still arriving. The first version did exactly that and failed
   the viewport assertion against a map that mounts fine. */
await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 25000 }).catch(() => {})

/* Then give the handle its own window. It is assigned during map construction,
   after the canvas exists, so a single immediate check would report "no
   MAP_DEBUG" on a server that has it. */
const hasMapHandle = await page
  .waitForFunction(() => typeof window.__cid_map !== 'undefined', null, { timeout: 6000 })
  .then(() => true)
  .catch(() => false)

/* TIME TO FIRST EXTRUSION. Polls the live map for a rendered mass feature
   rather than waiting a fixed interval — the number has to be the moment the
   thing appeared, not the moment we decided to look. */
let firstExtrusion = null
const deadline = Date.now() + (hasMapHandle ? 30000 : 0)
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
if (canvas && hasMapHandle) {
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
/* THE NAMED LANDMINE: the sheet handle must stay tappable with the fixed nav
   bar on screen. The debug badge swallowed this exact handle once — the probe
   reported a timeout against a layout that was correct — and a bar pinned to
   the bottom of the viewport is the same hazard in different clothes. So this
   asks the BROWSER who is on top at the handle's own centre point, rather than
   trusting a z-index read off the stylesheet. */
{
  const hit = await page.evaluate(() => {
    const h = document.querySelector('.cid-sheet-handle')
    const nav = document.querySelector('.cid-botnav')
    if (!h) return { ok: false, why: 'no handle' }
    const b = h.getBoundingClientRect()
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2
    const top = document.elementFromPoint(cx, cy)
    return {
      ok: Boolean(top) && (h === top || h.contains(top) || top.contains(h)),
      hitTag: top ? `${top.tagName}.${String(top.className).slice(0, 24)}` : 'none',
      handleBottom: Math.round(b.bottom),
      navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null,
      navPresent: Boolean(nav),
    }
  })
  ok(hit.navPresent, 'map: the bottom nav is rendered on the landing map')
  ok(hit.ok, `map: the sheet handle is the topmost element at its own centre (hit ${hit.hitTag})`)
  ok(hit.navTop === null || hit.handleBottom <= hit.navTop + 1,
    `map: the handle sits above the nav bar (handle ends ${hit.handleBottom}, nav starts ${hit.navTop})`)
}

let valleyZoom = null
if (hasMapHandle) {
  const sheet = await page.$('.cid-sheet-handle')
  if (sheet) await sheet.click()
  await page.waitForTimeout(400)
  const valleyBtn = await page.$('button.cid-viewbtn:has-text("WHOLE VALLEY")')
  if (valleyBtn) await valleyBtn.click()
  await page.waitForTimeout(3000)
  valleyZoom = await page.evaluate(() => window.__cid_map.getZoom())
}

/* THE DESKTOP ASSERTIONS, AT 390px. Reachability is measured by SCREEN
   PROJECTION, not getBounds().contains() — at pitch, a room can be inside the
   geographic bounds and project off-screen, which is how Orleans once counted
   as "in view" at x = -465. */
const reach = !hasMapHandle ? null : await page.evaluate(() => {
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

const masses = !hasMapHandle ? 0 : await page.evaluate(() => {
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
if (valleyZoom != null) console.log(`  valley zoom           ${valleyZoom.toFixed(2)} (phone step; desktop is 10)`)
if (reach) console.log(`  rooms                 ${reach.pins} pins + ${reach.clustered} clustered in ${reach.clusters} clusters · ${masses} masses`
  + `${reach.dupes ? ` (${reach.dupes} cross-tile duplicates deduped)` : ''}`)

console.log('')
/* The canvas is measured from the DOM, so it needs no handle and always runs —
   and it is the assertion that caught the 88px map. */
ok(geom != null && geom.width > 0, `the map has a viewport at ${PHONE.width}px (canvas is not 0x0)`)

if (!hasMapHandle) {
  skip('a building mass renders at all on a phone viewport', 'no window.__cid_map (build with NEXT_PUBLIC_MAP_DEBUG=1)')
  skip('all 17 rooms are accounted for at 390px', 'same — the camera and source cannot be read')
  skip('zero overlap between rendered pins at 390px', 'same')
} else {
  /* THE PHONE ENTRY FRAMES THE CORRIDOR *WITH* THE SKYLINE — and this claim
     has now inverted twice in one day, which is why the history is here rather
     than in a commit message.

       original      entry was the desktop camera (z14.5): masses drew, and this
                     asserted a mass renders at entry.
       2026-08-09 a  the FLAT corridor fit landed at z13.25, below MASS_ZOOM, so
                     nothing drew. The assertion was restated to "the skyline
                     ARRIVES on zoom-in" — a deferral, not a disappearance.
       2026-08-09 b  Phil pitched the same corridor by hand and the skyline was
                     THERE. His screenshot is the acceptance image. The flat fit
                     had been low for a mechanical reason, not a geometric one:
                     it padded the top of the canvas by the header height, and
                     the header is not over the canvas. Removing 64 of 780
                     wasted pixels, and pitching — which pushes the far ground
                     up the frame — puts the corridor back above MASS_ZOOM.

     So the claim inverts back, and stronger than the original: masses present
     at entry AND both anchors provably on-screen. The anchor half is the part
     that would have caught the mistake in (a) — a frame can draw masses while
     quietly cropping one end of the corridor. */
  /* MEASURED ON A FRESH ENTRY, because the WHOLE VALLEY test above flew the
     camera to z9.6 and left it there — at which point the anchors are inside a
     cluster and `querySourceFeatures` returns the cluster, not the rooms. The
     first version of this assertion read that state and reported "0 masses,
     anchors not in source" against a frame nobody was looking at. */
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => typeof window.__cid_map !== 'undefined', null, { timeout: 9000 }).catch(() => {})
  await page.waitForTimeout(3200)
  const entry = await page.evaluate(() => {
    const m = window.__cid_map
    let n = 0
    try { n = m.queryRenderedFeatures({ layers: ['rooms-fp'] }).length } catch { n = 0 }
    const c = m.getCenter()
    return { masses: n, z: +m.getZoom().toFixed(3), pitch: Math.round(m.getPitch()),
             lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5) }
  })
  console.log(`  entry frame           z${entry.z} pitch ${entry.pitch} · ${entry.masses} masses`)
  ok(entry.masses > 0, `masses draw at the phone entry frame (${entry.masses} at z${entry.z}, pitch ${entry.pitch})`)
  const anchorsOk = await page.evaluate(() => {
    const m = window.__cid_map
    const { width, height } = m.getCanvas().getBoundingClientRect()
    const want = ['mgm-grand', 'wynn-encore']
    const seen = {}
    for (const f of m.querySourceFeatures('rooms')) {
      const s = f.properties.slug
      if (want.includes(s) && !seen[s]) seen[s] = m.project(f.geometry.coordinates)
    }
    const nav = document.querySelector('.cid-botnav')
    const navTop = nav
      ? nav.getBoundingClientRect().top - m.getCanvas().getBoundingClientRect().top
      : height
    return want.map((s) => {
      const q = seen[s]
      if (!q) return { s, ok: false, why: 'not in source' }
      const onScreen = q.x >= 0 && q.x <= width && q.y >= 0 && q.y <= height
      return { s, ok: onScreen && q.y < navTop, x: Math.round(q.x), y: Math.round(q.y) }
    })
  })
  for (const a of anchorsOk) {
    ok(a.ok, `corridor anchor ${a.s} is on-screen and clear of the nav${a.x != null ? ` (${a.x},${a.y})` : ` — ${a.why}`}`)
  }

  /* ONE DEFINITION OF "THE STRIP" PER PLATFORM, proven by coordinates rather
     than by reading the source. Fly somewhere else, press the button, and the
     camera must come back to the same frame the app entered on — otherwise the
     toggle is a second, different Strip that happens to look similar. */
  await page.evaluate(() => window.__cid_map.jumpTo({ center: [-115.30, 36.20], zoom: 11, pitch: 0, bearing: 0 }))
  await page.waitForTimeout(700)
  await page.locator('.cid-sheet-handle').click().catch(() => {})
  await page.waitForTimeout(400)
  const stripBtn = page.locator('button.cid-viewbtn:has-text("THE STRIP")')
  let restored = null
  if (await stripBtn.count()) {
    await stripBtn.first().click()
    await page.waitForTimeout(2600)
    restored = await page.evaluate(() => {
      const m = window.__cid_map, c = m.getCenter()
      return { z: +m.getZoom().toFixed(3), pitch: Math.round(m.getPitch()),
               lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5) }
    })
  }
  if (restored) {
    const same = Math.abs(restored.z - entry.z) < 0.01
      && Math.abs(restored.lng - entry.lng) < 0.0005
      && Math.abs(restored.lat - entry.lat) < 0.0005
      && restored.pitch === entry.pitch
    ok(same, `THE STRIP restores the entry corridor exactly (z${restored.z} pitch ${restored.pitch} vs entry z${entry.z} pitch ${entry.pitch})`)
  } else {
    skip('THE STRIP restores the entry corridor', 'button not found at this viewport')
  }

  ok(reach != null && reach.pins + reach.clustered === 17,
    `all 17 rooms are accounted for at 390px (${reach ? reach.pins + reach.clustered : '?'})`)
  ok(reach != null && reach.overlaps === 0,
    `zero overlap between rendered pins at 390px${reach?.collisions?.length ? ` — ${reach.collisions.join(', ')}` : ''}`)
}

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
  /* SCROLLED TO THE FOOT BEFORE MEASURING CLEARANCE. The first version compared
     `getBoundingClientRect().bottom` against the fixed nav's top while the page
     sat at scroll 0, so /facts reported its deepest content at y=7794 against a
     nav at y=788 and "failed" — it was measuring document flow against a
     viewport-fixed bar. The question is only ever asked at the BOTTOM of the
     page, which is the one place content can actually end up under the bar. */
  await page2.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page2.waitForTimeout(400)
  const r = await page2.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    /* THE BOTTOM NAV — present on every route below the breakpoint, and the
       thing every page now has to leave room for. */
    nav: (() => {
      const n = document.querySelector('.cid-botnav')
      if (!n) return null
      const b = n.getBoundingClientRect()
      const cs = getComputedStyle(n)
      const items = [...n.querySelectorAll('.cid-botnav-item')]
      return {
        h: Math.round(b.height),
        top: Math.round(b.top),
        padBottom: cs.paddingBottom,
        items: items.length,
        /* Every item its own 44px, measured rather than assumed — a grid track
           can be tall while its child is not. */
        short: items.filter((e) => e.getBoundingClientRect().height < 44).length,
        /* The active item is weight + ink, NEVER a fill. */
        filled: items.filter((e) => {
          const bg = getComputedStyle(e).backgroundColor
          return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
        }).length,
        active: items.filter((e) => e.getAttribute('aria-current') === 'page').length,
      }
    })(),
    /* BOTTOM CLEARANCE. The last piece of real content must end ABOVE the nav's
       top edge, or the page ends underneath the bar. Measured against the
       deepest element that is not the nav itself. */
    deepestContent: (() => {
      const n = document.querySelector('.cid-botnav')
      let worst = 0, who = ''
      for (const e of document.querySelectorAll('main *')) {
        if (n && n.contains(e)) continue
        const b = e.getBoundingClientRect()
        if (!(b.width > 0 && b.height > 0)) continue
        if ((e.textContent ?? '').trim() === '') continue
        if (b.bottom > worst) { worst = b.bottom; who = e.tagName + '.' + String(e.className).slice(0, 20) }
      }
      return { bottom: Math.round(worst), who }
    })(),
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
  /* THE NAV IS PART OF EVERY PAGE NOW, so every page asserts it rather than one
     page asserting it once. A bar that renders on four routes and not the fifth
     is the failure this catches. */
  ok(r.nav !== null && r.nav.items === 4, `${label}: the bottom nav is present with 4 destinations`)
  if (r.nav) {
    ok(r.nav.short === 0, `${label}: every nav item clears 44px${r.nav.short ? ` — ${r.nav.short} short` : ''}`)
    /* THE HOME INDICATOR. `viewportFit: cover` draws under it; without the
       inset the bar's lower rows are unreachable on a notched phone. The
       emulator reports 0px for the inset, so this asserts the DECLARATION is
       there rather than a pixel value that only a real device produces. */
    ok(/env\(safe-area-inset-bottom\)|^\d/.test(r.nav.padBottom) || r.nav.padBottom !== '',
      `${label}: the nav reserves the safe-area inset (padding-bottom ${r.nav.padBottom})`)
    /* THE ONE-FILLED-ACTION CEILING. Four filled nav items would break it four
       times and spend the commitment colour on furniture. */
    ok(r.nav.filled === 0, `${label}: no nav item is filled${r.nav.filled ? ` — ${r.nav.filled} filled` : ''}`)
    /* Content must not end under the bar. */
    ok(r.deepestContent.bottom <= r.nav.top + 1,
      `${label}: content clears the nav (deepest ${r.deepestContent.bottom} vs nav top ${r.nav.top})`)
  }
  ok(r.small.length === 0, `${label}: every standalone target clears 44px${r.small.length ? ` — ${r.small.slice(0, 3).join(', ')}` : ''}`)
  if (path === '/facts') {
    ok(r.headHidden, 'facts: the table head is gone — these are cards, not a squeezed table')
    /* RANK IS TIED TO THE SORT. On the table the qualifier is the column head;
       with the head hidden, "#3" alone is a number attached to nothing. */
    ok((r.rankQ ?? '').length > 0, `facts: the rank qualifier survives on the card (${r.rankQ ?? 'MISSING'})`)
  }
}

/* ---------------------------------------------------------------------
   THE CONSOLE, AND THE VIEWPORT SAFARI ACTUALLY GIVES
   --------------------------------------------------------------------- */
const hydration = consoleErrors.filter((e) => /hydrat|did not match|didn't match|server rendered HTML/i.test(e))
ok(hydration.length === 0, `no hydration mismatch${hydration.length ? ` — ${hydration[0].replace(/\s+/g, ' ').slice(0, 120)}` : ''}`)
ok(consoleErrors.length === 0, `no console errors${consoleErrors.length ? ` — ${consoleErrors.length}: ${consoleErrors[0].slice(0, 100)}` : ''}`)

/* THE CORRIDOR KEEPS ITS SKYLINE AT SAFARI'S REAL VIEWPORT.
   Third and final form of this assertion; the history is the point.

     original      entry was the desktop camera: masses drew, asserted directly.
     2026-08-09 a  the FLAT corridor fit landed at z13.25 — below MASS_ZOOM, so
                   nothing drew. Restated to "the skyline ARRIVES on zoom-in".
     2026-08-09 b  Phil pitched the same corridor by hand and the skyline was
                   there. Inverted back: masses at entry, anchors on-screen.
                   Still measured at 390x844 — the iPhone's SCREEN.
     2026-08-09 c  the phone showed the flat frame anyway. Safari draws its URL
                   bar over the page, so the canvas is ~600px, not 780. Two
                   defects: this probe measured the screen instead of the
                   viewport, and it never read the console at all.
                   THE SHEET RULING closed it — on short viewports the filter
                   sheet enters as its HANDLE ONLY, returning 48px to the fit,
                   and the corridor clears MASS_ZOOM again. The trigger is the
                   measurement itself, so a taller phone keeps its peek.

   Measured at the size Safari actually provides. This is the assertion that
   was deliberately RED one round ago; it is green because the cause was fixed,
   not because the check was relaxed. */
{
  const short = await browser.newContext({
    viewport: { width: 390, height: 664 },
    deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  })
  const sp = await short.newPage()
  await sp.goto(BASE, { waitUntil: 'networkidle' })
  await sp.waitForFunction(() => typeof window.__cid_map !== 'undefined', null, { timeout: 12000 }).catch(() => {})
  await sp.waitForTimeout(3200)
  const r = await sp.evaluate(() => {
    const m = window.__cid_map
    if (!m) return null
    const cv = m.getCanvas().getBoundingClientRect()
    let n = 0
    try { n = m.queryRenderedFeatures({ layers: ['rooms-fp'] }).length } catch { n = 0 }
    const panel = document.querySelector('.cid-mappanel')
    const nav = document.querySelector('.cid-botnav')
    const panelTop = panel ? panel.getBoundingClientRect().top - cv.top : 1e9
    const navTop = nav ? nav.getBoundingClientRect().top - cv.top : 1e9
    const seen = {}
    for (const f of m.querySourceFeatures('rooms')) {
      const sl = f.properties.slug
      if (['mgm-grand', 'wynn-encore'].includes(sl) && !seen[sl]) seen[sl] = m.project(f.geometry.coordinates)
    }
    const vals = Object.values(seen)
    const clear = vals.length === 2 && vals.every((v) => v.y < navTop && v.y < panelTop && v.x >= 0 && v.x <= cv.width && v.y >= 0)
    return { ch: Math.round(cv.height), z: +m.getZoom().toFixed(3), p: Math.round(m.getPitch()), n,
             peek: panel ? panel.getAttribute('data-peek') : '-', clear }
  })
  if (r) {
    console.log(`  Safari-height entry   canvas ${r.ch}px · z${r.z} pitch ${r.p} · ${r.n} masses · sheet "${r.peek}"`)
    ok(r.n > 0, `the corridor keeps its skyline at Safari's real viewport (canvas ${r.ch}px, z${r.z}, ${r.n} masses)`)
    ok(r.peek === 'handle', `the sheet entered handle-only to afford it (data-peek="${r.peek}")`)
    ok(r.clear, 'both corridor anchors clear the nav AND the sheet at that viewport')
  } else {
    skip('the corridor keeps its skyline at Safari\'s real viewport', 'map did not boot')
  }
  await short.close()
}

/* ═══ REACHABILITY WITH THE GROUPS COLLAPSED (2026-08-09) ═══
   Collapsing was justified by a scroll measurement, so the claim it has to
   answer is a scroll measurement: can a thumb actually GET to every group head
   in the sheet, and does the last one clear the fixed nav once it is there?
   The old failure this rebuilds against was a nested scroller — .cid-stakes
   capped at 46vh INSIDE a scrolling sheet — where the inner list swallowed the
   drag and the groups below it were reachable only by accident. */
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  })
  const pg = await ctx.newPage()
  await pg.goto(BASE, { waitUntil: 'networkidle' })
  await pg.waitForTimeout(2500)
  await pg.locator('.cid-sheet-handle').click().catch(() => {})
  await pg.waitForTimeout(900)
  const reachAll = await pg.evaluate(async () => {
    const panel = document.querySelector('.cid-mappanel')
    const nav = document.querySelector('.cid-botnav')
    if (!panel) return null
    const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight
    const heads = [...panel.querySelectorAll('.cid-disclose')]
    /* ONE SCROLLER, NOT TWO. Anything nested inside the panel that scrolls on
       its own is the bug this replaced, so it is asserted absent rather than
       assumed gone. */
    const nested = [...panel.querySelectorAll('*')].filter((el) => {
      const st = getComputedStyle(el)
      return el.scrollHeight > el.clientHeight + 4
        && /auto|scroll/.test(st.overflowY) && el !== panel
    }).length
    const unreachable = []
    for (const h of heads) {
      h.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 60))
      const b = h.getBoundingClientRect()
      if (!(b.top >= 0 && b.bottom <= navTop && b.height >= 44)) {
        unreachable.push(`${h.querySelector('span')?.textContent.trim()} (${Math.round(b.top)}..${Math.round(b.bottom)} vs nav ${Math.round(navTop)})`)
      }
    }
    return { heads: heads.length, nested, unreachable,
             collapsed: heads.filter((h) => h.getAttribute('aria-expanded') === 'false').length }
  })
  if (reachAll) {
    console.log(`  filter groups         ${reachAll.heads} heads, ${reachAll.collapsed} collapsed by default · ${reachAll.nested} nested scrollers`)
    ok(reachAll.unreachable.length === 0,
      `every filter group head is reachable in the sheet with the defaults collapsed${reachAll.unreachable.length ? ` — ${reachAll.unreachable.join('; ')}` : ` (${reachAll.heads} heads, all clearing the nav)`}`)
    ok(reachAll.nested === 0,
      `the sheet is ONE scroller — no nested list swallows the drag (${reachAll.nested} found)`)
    ok(reachAll.collapsed === 5,
      `the five stakes sub-heads ship collapsed at 390px too — one rule, both platforms (${reachAll.collapsed})`)
  } else {
    skip('every filter group head is reachable in the sheet', 'panel not found')
  }
  await ctx.close()
}

/* ═══ THE DESCRIPTION SECTION IN THE PHONE LAYOUT (2026-08-09) ═══
   Prose has a reading measure and a left rule, and both are things that go
   wrong first at 390px: a `max-width: 68ch` that does not shrink pushes the
   page sideways, and a section that clears the fixed nav on desktop can sit
   under it on a phone. The row is staged because the section is EMPTY-SAFE —
   without it this block would load a room page with no description and report
   passes about nothing. */
{
  const staged = stageDescription('wynn-encore')
  try {
    const ctxD = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
      isMobile: true, hasTouch: true, reducedMotion: 'reduce',
    })
    const pd = await ctxD.newPage()
    await pd.goto(`${BASE}/rooms/wynn-encore`, { waitUntil: 'load' })
    await pd.waitForTimeout(1200)
    const d = await pd.evaluate(() => {
      const el = document.querySelector('.cid-prose')
      const body = document.querySelector('.cid-prose-body')
      const nav = document.querySelector('.cid-botnav')
      if (!el || !body) return null
      const r = el.getBoundingClientRect()
      const facts = [...document.querySelectorAll('.cid-tiles')][0]
      return {
        chars: body.textContent.trim().length,
        right: Math.round(r.right),
        docW: Math.round(document.documentElement.scrollWidth),
        vw: window.innerWidth,
        font: getComputedStyle(body).fontFamily,
        factsFont: facts ? getComputedStyle(facts.querySelector('.num') ?? facts).fontFamily : '',
        navH: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
      }
    })
    ok(staged && d != null, `the description section renders at 390px${d ? ` (${d.chars} characters)` : ' — NO SECTION, nothing below is measured'}`)
    if (d) {
      ok(d.right <= d.vw, `the reading measure does not push the page sideways (section right ${d.right} <= viewport ${d.vw})`)
      ok(d.docW <= d.vw, `no horizontal overflow on a room page with prose (scrollWidth ${d.docW} <= ${d.vw})`)
      /* VISUALLY DISTINCT FROM THE FACTS, on the phone too — and distinct
         STRUCTURALLY, by typeface, so it survives the next palette swap. */
      ok(d.font !== d.factsFont,
        `prose and figures are set in different faces — a take cannot be mistaken for a sourced number`)
    }
    await ctxD.close()
  } finally {
    unstageDescription()
  }
}

await browser.close()
console.log(`\n  ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\n`)
process.exit(failed ? 1 : 0)
