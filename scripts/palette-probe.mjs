#!/usr/bin/env node
/**
 * THE THREE PER-SCREEN INVARIANTS, MEASURED IN A BROWSER.
 *
 *   1. body.scrollWidth <= viewport      — no page scrolls sideways
 *   2. 0 text nodes below 4.5:1          — WITH alpha composited and effective
 *                                          opacity multiplied down the chain
 *   3. exactly one filled action         — the accent-700 fill, once per screen
 *
 * WHY THIS FILE EXISTS AT ALL. The palette doc asserts all three as standing
 * invariants and no suite measured any of them. The contrast one is the reason
 * it now does: a compare-dimmed row rendered at `opacity: 0.42` measured
 * 3.76:1 at the lead and 2.56:1 at the peers, and every audit that had ever
 * looked reported zero failures — because a naive walker reads
 * `getComputedStyle(el).color`, which returns the AUTHORED colour and knows
 * nothing about an `opacity` on an ancestor three levels up. The state was
 * two-and-a-half to one and invisible to the tooling.
 *
 * SO THE RULE, AND IT IS THE WHOLE POINT OF THE FILE:
 *   - `opacity` MULTIPLIES down the ancestor chain. 0.42 inside 0.9 is 0.378.
 *   - an rgba() colour COMPOSITES over whatever is actually behind it, which
 *     means walking up for the first non-transparent background, not assuming
 *     the page colour.
 *   - both, together, on every text node. Ignoring alpha reported 25 false
 *     failures; ignoring opacity hid 12 real ones. Either alone is worse than
 *     useless because it is confidently wrong.
 *
 *   node scripts/palette-probe.mjs [url]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000'
const VIEWPORT = { width: 1440, height: 900 }

/* The four built surfaces, plus the compare state — which is the ONE state that
   exercises the dimmed row, and therefore the only place the bug this probe was
   written for can appear. A gate that never opens the drawer does not guard it. */
import { stageDescription, unstageDescription } from './stage-description.mjs'

const SCREENS = [
  ['landing map', '/'],
  /* PROSE IS NEW TEXT, so it is measured like every other text node — composited
     against its ground with the opacity of every ancestor multiplied in. The
     row is staged below and removed in a finally; without it the section does
     not render and this screen would measure a page that has no description on
     it at all. */
  ['room detail (with prose)', '/rooms/aria'],
  /* Wynn is the only room with tournaments, so it is the only screen where
     those text nodes exist to be composited. */
  ['room detail (tournaments)', '/rooms/wynn-encore'],
  ['just the facts', '/facts'],
  ['facts + compare (the dim state)', '/facts?compare=venetian,south-point'],
  ['tournaments', '/tournaments'],
  ['promos', '/promos'],
]

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/* Everything below runs INSIDE the page. */
const AUDIT = () => {
  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const Y = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => { const [x, y] = [Y(a), Y(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const over = (fg, bg) => ({
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b, a: 1,
  })

  /* THE BACKDROP IS WALKED FOR, NOT ASSUMED. The first ancestor with a
     non-transparent background is what the text actually sits on; assuming the
     page colour is how a card on a raised surface gets audited against the
     wrong ground and passes. */
  const backdrop = (el) => {
    let acc = null
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor)
      if (!bg || bg.a === 0) continue
      acc = acc ? over(acc, bg) : bg
      if (acc.a === 1 || bg.a === 1) return { ...acc, a: 1 }
    }
    return acc ? { ...acc, a: 1 } : { r: 0, g: 0, b: 0, a: 1 }
  }

  /* OPACITY MULTIPLIES. This is the line the old audits did not have. */
  const effectiveOpacity = (el) => {
    let o = 1
    for (let n = el; n; n = n.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity)
      if (!Number.isNaN(v)) o *= v
    }
    return o
  }

  const failures = []
  let checked = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || '').trim()
    if (!text) continue
    const el = node.parentElement
    if (!el) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const fg = parse(cs.color)
    if (!fg) continue
    const opac = effectiveOpacity(el)
    if (opac === 0) continue
    const bg = backdrop(el)
    /* The text's own alpha AND every ancestor opacity, in one composite. */
    const shown = over({ ...fg, a: fg.a * opac }, bg)
    const r = ratio(shown, bg)
    checked++

    /* 3:1 is the large-text threshold; everything else is 4.5:1. */
    const px = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 700
    const large = px >= 24 || (bold && px >= 18.66)
    const floor = large ? 3 : 4.5

    if (r < floor) {
      failures.push({
        text: text.slice(0, 42), ratio: Math.round(r * 100) / 100, floor,
        color: cs.color, opacity: Math.round(opac * 1000) / 1000,
        tag: el.tagName.toLowerCase(), cls: el.className?.toString().slice(0, 40) ?? '',
      })
    }
  }

  /* THE ONE FILLED ACTION. Read from the token rather than a hardcoded hex, so
     this keeps working the next time the palette moves. */
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--cid-accent-700').trim()
  const fillTarget = parse(accent)
  const sameFill = (c) => fillTarget && c && c.a > 0.9
    && Math.abs(c.r - fillTarget.r) < 3 && Math.abs(c.g - fillTarget.g) < 3 && Math.abs(c.b - fillTarget.b) < 3
  const visible = [...document.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return false
    const rect = el.getBoundingClientRect()
    return rect.width >= 8 && rect.height >= 8
  })
  const filled = visible.filter((el) => sameFill(parse(getComputedStyle(el).backgroundColor)))
    .map((el) => `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 30) ?? ''}`)

  /* GOLD NEVER FILLS A SURFACE — the law, as a measurement. Read from the ramp
     rather than a literal so it survives the next swap. Small swatches are
     already excluded above; this is about a FIELD of gold. */
  const goldFills = []
  for (const name of ['--cid-gold-700', '--cid-gold-500', '--cid-gold-300', '--cid-gold-200']) {
    const g = parse(getComputedStyle(document.documentElement).getPropertyValue(name).trim())
    if (!g) continue
    for (const el of visible) {
      const bg = parse(getComputedStyle(el).backgroundColor)
      if (bg && bg.a > 0.9 && Math.abs(bg.r - g.r) < 3 && Math.abs(bg.g - g.g) < 3 && Math.abs(bg.b - g.b) < 3) {
        goldFills.push(`${name} on ${el.tagName.toLowerCase()}`)
      }
    }
  }

  return {
    scrollWidth: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    checked, failures: failures.slice(0, 12), failureCount: failures.length,
    filled, accent, goldFills: [...new Set(goldFills)],
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: VIEWPORT })
const consoleNoise = []
/* HMR/websocket chatter is the DEV SERVER talking, not the app. Filtered by
   pattern rather than by turning the check off, so a real console error still
   fails the run — and the filter is narrow enough to be obviously wrong if it
   ever starts swallowing something real. */
const DEV_NOISE = /_next\/hmr|websocket|hot-update|Download the React DevTools/i
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (!DEV_NOISE.test(t)) consoleNoise.push(t)
})

/* STAGED FOR EVERY ROOM SCREEN, not just the first. A second room screen was
   added for the tournaments text nodes and the prose assertions duly reported
   "NO SECTION" against it — the fixture covered one room and the assertions
   covered all of them. A suite has to stage everything it measures. */
const ROOM_SCREENS = SCREENS.filter(([, path]) => path.startsWith('/rooms/'))
  .map(([, path]) => path.replace('/rooms/', ''))
const staged = ROOM_SCREENS.map((slug) => stageDescription(slug)).every(Boolean)
if (!staged) {
  console.log('  FAIL  the prose fixture could not be staged — the room-detail screen would measure a page with no description')
  fail++
}
try {

for (const [name, path] of SCREENS) {
  console.log(`\n== ${name}  (${path}) ==`)
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(400)

  /* ⚠️ EXPAND THE ATTRIBUTION BEFORE SWEEPING. It is collapsed to a ⓘ on load
     now (2026-08-10), and a collapsed credit is `display: none` — invisible to
     a contrast sweep that only measures rendered text.
     This sweep is what caught the attribution links at 1.14:1, a failure that
     had shipped since the map did. If the collapse quietly took that text out
     of scope, the regression could come back with every gate green — the
     licence text would still be there, still one tap away, and still
     unreadable. So it is opened first and measured with everything else. */
  await page.evaluate(async () => {
    const btn = document.querySelector('.maplibregl-ctrl-attrib-button')
    if (btn && !document.querySelector('.maplibregl-compact-show')) {
      btn.click()
      await new Promise((r) => setTimeout(r, 300))
    }
  })
  await page.waitForTimeout(200)
  const r = await page.evaluate(AUDIT)

  /* THE SCREEN LOADED AT ALL — asserted FIRST, and the only reason this line
     exists is that it was missing. A 500 from the dev server renders an empty
     body: zero text nodes, zero filled elements, zero gold fills, and this
     probe reported four PASSES per screen against a page that did not exist.
     A gate that cannot tell "clean" from "absent" is the exact failure this
     project keeps finding, and it found it here in its own new gate. */
  ok(`${name}: the page rendered`, r.checked > 0 && r.accent !== '',
    r.checked > 0 ? `${r.checked} text nodes, tokens resolving` : 'NO TEXT AND NO TOKENS — the page did not render')
  ok(`${name}: no horizontal overflow`, r.scrollWidth <= r.inner, `scrollWidth ${r.scrollWidth} <= ${r.inner}`)
  ok(`${name}: every text node clears its floor`, r.failureCount === 0,
    r.failureCount === 0 ? `${r.checked} nodes measured, opacity composited` : `${r.failureCount} of ${r.checked} below floor`)
  for (const f of r.failures) {
    console.log(`          ${f.ratio}:1 (needs ${f.floor}) "${f.text}" <${f.tag} class="${f.cls}"> color ${f.color} effective-opacity ${f.opacity}`)
  }
  /* AT MOST ONE, WHICH IS WHAT THE LAW ACTUALLY SAYS: "carries the one filled
     action per screen … NOTHING ELSE IS FILLED." That is a ceiling, not a
     quota. Measured at rest the four public surfaces carry ZERO — the filled
     action on this product appears on interaction (the map popup's CTA, a
     checked filter box) rather than sitting on the page. Asserting a floor of
     one here would not have found a bug; it would have demanded four new CTAs
     to satisfy a probe, which is a design decision and not a palette one. The
     count is reported either way so the look-gate can rule on it. */
  ok(`${name}: no more than one filled action`, r.filled.length <= 1,
    `${r.filled.length} filled with ${r.accent}${r.filled.length ? ` — ${r.filled.join(', ')}` : ' (the CTA appears on interaction)'}`)
  ok(`${name}: gold never fills a surface`, r.goldFills.length === 0,
    r.goldFills.length ? r.goldFills.join(', ') : 'no gold-filled element')

  /* THE PROSE ACTUALLY RENDERED. Without this the room-detail screen would
     report five cheerful passes against a page whose description section is
     simply absent — the vacuous shape this file already guards against with
     "the page rendered". */
  if (path.startsWith('/rooms/')) {
    /* ═══ THE FACTS GRID: NO ORPHAN CELL, AND NO CELL SHOWING THE LINE ═══
       Phil reported "two boxes in the wrong colour". They were not mis-painted
       tiles — they were MISSING tiles. The grid is three columns fed by an
       array, and a room with four facts left the last row two short, so the
       container's --cid-line-1 showed through the gap and read as a value.
       That makes this a palette assertion as much as a layout one: the failure
       presented as a colour, and the fix is that every cell in the grid paints
       the tile background. */
    const grid = await page.evaluate(() => {
      const el = document.querySelector('.cid-tiles')
      if (el == null) return null
      const cs = getComputedStyle(el)
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length
      const cells = [...el.children]
      const probe = document.createElement('span')
      probe.style.background = 'var(--cid-ink-700)'
      document.body.appendChild(probe)
      const tile = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        cols, count: cells.length,
        offPalette: cells
          .map((c) => getComputedStyle(c).backgroundColor)
          .filter((bg) => bg !== tile).length,
      }
    })
    if (grid == null) {
      ok(`${name}: the facts grid renders`, false, 'no .cid-tiles on the page')
    } else {
      ok(`${name}: the facts grid has no orphan cell`,
        grid.count % grid.cols === 0,
        `${grid.count} cells across ${grid.cols} columns — ${grid.count % grid.cols} orphan(s)`)
      ok(`${name}: every cell paints the tile background, none shows the grid line`,
        grid.offPalette === 0,
        grid.offPalette === 0 ? `all ${grid.count} cells on --cid-ink-700` : `${grid.offPalette} cell(s) off-palette`)
    }

    /* PROSE IS PARAGRAPHS, NOT A WALL. The body is stored with its blank-line
       breaks and was rendered in a single <p>, where HTML collapses every
       newline to a space — 2359 characters of Wynn in one block. Asserted as a
       COUNT rather than "it renders", because one paragraph is exactly what the
       bug produced and "it renders" was true throughout. */
    const proseSet = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('.cid-prose-body')]
      const date = document.querySelector('.cid-prose-date')
      if (ps.length === 0) return null
      const cs = getComputedStyle(ps[0])
      const w = ps[0].getBoundingClientRect().width
      const cv = document.createElement('canvas').getContext('2d')
      cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const avg = cv.measureText('abcdefghijklmnopqrstuvwxyz ').width / 27
      return { paras: ps.length, chars: Math.round(w / avg),
               dateShown: date != null && date.getBoundingClientRect().height > 0,
               dateText: date?.textContent.trim() ?? null }
    })
    if (proseSet == null) {
      console.log(`  SKIP  ${name}: the prose section — this room carries no description`)
    } else {
      ok(`${name}: the review renders as paragraphs, not one block`,
        proseSet.paras > 1, `${proseSet.paras} paragraphs`)
      /* 45–75 is the comfortable measure; 68ch was setting 80 because `ch` is
         the zero glyph and overshoots for lowercase. */
      ok(`${name}: the reading measure is within the comfortable band`,
        proseSet.chars >= 45 && proseSet.chars <= 75, `~${proseSet.chars} characters per line`)
      ok(`${name}: the first-seen date stays visible`,
        proseSet.dateShown, proseSet.dateText ?? 'absent')
    }

    /* ⚠️ A CONFIRMED ABSENCE MUST NOT RENDER AS THE NOT-CHECKED DASH. Caesars
       Palace says "Checked on site — no amenities" further down this page; if
       its parking and food tiles showed the em-dash, one page would make two
       contradictory statements about the same visit. Asserted on the room that
       actually has the data, by name, rather than on whichever room the screen
       list happens to open. */
    const absent = await page.evaluate(async () => {
      const res = await fetch('/rooms/caesars-palace')
      const html = await res.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const tiles = [...(doc.querySelector('.cid-tiles')?.children ?? [])]
      const read = (label) => {
        const t = tiles.find((c) => c.querySelector('.cid-label')?.textContent.trim() === label)
        return t == null ? null : t.textContent.replace(label, '').trim()
      }
      return { parking: read('FREE PARKING'), food: read('TABLESIDE FOOD'), cocktails: read('COCKTAILS') }
    })
    ok(`${name}: a confirmed-absent fact never renders as the not-checked dash`,
      absent.parking != null && !absent.parking.includes('\u2014') && /None/.test(absent.parking)
      && absent.food != null && !absent.food.includes('\u2014') && /None/.test(absent.food),
      `caesars-palace parking "${absent.parking}" · food "${absent.food}"`)
    ok(`${name}: and a genuinely unchecked fact still does`,
      absent.cocktails != null && absent.cocktails.includes('\u2014'),
      `caesars-palace cocktails "${absent.cocktails}" — no row, so no check`)

    const prose = await page.evaluate(() => {
      const el = document.querySelector('.cid-prose-body')
      return el == null ? null : el.textContent.trim().length
    })
    ok(`${name}: the description section rendered`, (prose ?? 0) > 0,
      prose ? `${prose} characters of prose measured above` : 'NO SECTION — the screen above measured nothing')
  }
}

} finally {
  unstageDescription()
}

console.log(`\nconsole errors: ${consoleNoise.length}`)
for (const c of consoleNoise.slice(0, 5)) console.log(`  ${c}`)

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) { console.log('Palette probe FAILED.'); process.exit(1) }
console.log('Palette probe passed.')
