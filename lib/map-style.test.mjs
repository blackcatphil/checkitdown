/**
 * The map is the least testable surface in the product — but a pure style
 * transform is not. These run with no browser and no network.
 *
 * HALF OF THESE ASSERT AGAINST THE REAL PALETTE, parsed out of
 * app/styles/tokens/colors.css, not against a mock. A mock satisfies whatever
 * invariant you write for it while the shipped colours quietly break the same
 * rule — and on this map a hand-made fixture has already been wrong three
 * times. The rules here are about MEANING (chroma, figure/ground,
 * contrast), so they are only worth anything if they run on the values that
 * actually paint.
 *
 *   node --test lib/map-style.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyPalette, classifyLayer, paletteCoverage } from './map-style.ts'

/* ---------- the real palette ---------- */

const CSS = readFileSync(join(import.meta.dirname, '../app/styles/tokens/colors.css'), 'utf8')
/* The dark block only: `[data-cid-theme="light"]` redefines the same names, and
   a naive last-wins parse would silently test the light theme.
   Anchored on the SELECTOR (`... {`) and searched from `:root` onward, because
   the file's own header comment names the light theme — matching the bare
   string found it at index 63, before the palette, and every token then read as
   "not defined". A delimiter that also occurs in prose is not a delimiter. */
const ROOT_AT = CSS.indexOf(':root')
const LIGHT_AT = CSS.indexOf('[data-cid-theme="light"] {', ROOT_AT)
assert.ok(ROOT_AT >= 0 && LIGHT_AT > ROOT_AT, 'could not locate the dark palette block in colors.css')
const DARK = CSS.slice(ROOT_AT, LIGHT_AT)

/* ALIASES ARE RESOLVED, because the browser resolves them and a test that does
   not is testing a different stylesheet. The palette now defines several tokens
   as `var(--cid-…)` — the decorative gold names onto the canonical ramp, the
   two depth shades, the deprecated --cid-value onto --cid-text — and a helper
   that parsed hexes only read every one of them as "not a colour" and reported
   NaN. NaN compares false against everything, so those assertions did not fail
   loudly; they passed or failed for reasons unrelated to the palette.
   Depth-limited so a token that eventually points at itself raises here rather
   than hanging the suite. */
function token(name, depth = 0) {
  const m = DARK.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  assert.ok(m, `${name} is not defined in colors.css`)
  const v = m[1].trim()
  const alias = v.match(/^var\(\s*(--cid-[a-z0-9-]+)\s*\)$/)
  if (alias) {
    assert.ok(depth < 8, `${name} resolves through more than 8 aliases — probably a cycle`)
    return token(alias[1], depth + 1)
  }
  return v
}

/** #rgb / #rrggbb / rgba() -> {r,g,b,a} in 0-255 (a in 0-1). */
function parseColour(v) {
  const rgba = v.match(/rgba?\(([^)]+)\)/)
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((x) => x.trim())
    return { r: +r, g: +g, b: +b, a: +a }
  }
  const hex = v.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  }
}

/** WCAG relative luminance. */
function luminance(c) {
  const ch = (v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * CHROMA — absolute colourfulness, i.e. how much colour signal a swatch
 * actually carries.
 *
 * Deliberately NOT HSL saturation, which divides by lightness: a near-black
 * with a faint blue lean scored 0.34 against a vivid signal's 0.47 and read as
 * a rival when it was barely a colour at all. "Does this compete with the mark?"
 * is a question about absolute colour, so it needs an absolute measure.
 */
const chroma = (c) => (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255

/** Hue in degrees, 0-360. */
function hue(c) {
  const [r, g, b] = [c.r / 255, c.g / 255, c.b / 255]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)) % 360; return d > 180 ? 360 - d : d }

/** Composite a translucent colour over an opaque one. */
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
})

const C = (name) => parseColour(token(name))

const GROUND = [
  '--cid-map-land', '--cid-map-land-2', '--cid-map-natural',
  '--cid-map-water', '--cid-map-water-line', '--cid-map-building',
  '--cid-map-road-minor', '--cid-map-road-casing', '--cid-map-road-major',
]

/* ---------- the transform ---------- */

const T = {
  land: '#0B0910',
  land2: '#120E1A',
  natural: '#1C2318',
  water: '#141634',
  waterLine: '#1E2149',
  building: '#191322',
  buildingEdge: '#251C34',
  roadMinor: '#241C0A',
  roadCasing: '#5C4915',
  roadMajor: '#574B70',
  boundary: 'rgba(169,140,232,0.22)',
  dim: 'rgba(242,244,246,0.58)',
}

/* The REAL layer ids from OpenFreeMap Positron — the style we actually ship.
   Invented ids would let the classifier pass while mis-sorting every layer the
   map draws. */
const STYLE = {
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'park', type: 'fill', paint: {} },
    { id: 'water', type: 'fill', paint: {} },
    { id: 'landcover_wood', type: 'fill', paint: {} },
    { id: 'landuse_residential', type: 'fill', paint: {} },
    { id: 'building', type: 'fill', paint: { 'fill-antialias': true, 'fill-outline-color': 'rgb(219,219,218)' } },
    { id: 'waterway', type: 'line', paint: {} },
    { id: 'highway_minor', type: 'line', paint: { 'line-width': 3 } },
    { id: 'highway_major_inner', type: 'line', paint: {} },
    { id: 'highway_motorway_casing', type: 'line', paint: {} },
    { id: 'railway', type: 'line', paint: {} },
    { id: 'boundary_2', type: 'line', paint: {} },
    { id: 'label_city', type: 'symbol', layout: { 'text-field': 'x' } },
    { id: 'highway-shield-us-interstate', type: 'symbol', paint: {}, layout: { 'icon-image': 'x' } },
    { id: 'water_name_point_label', type: 'symbol', layout: { 'text-field': 'x' } },
    { id: 'odd', type: 'heatmap', paint: { 'heatmap-radius': 9 } },
  ],
}

const out = () => applyPalette(STYLE, T)
const find = (id) => out().layers.find((l) => l.id === id)

test('the input style is not mutated', () => {
  const before = JSON.stringify(STYLE)
  applyPalette(STYLE, T)
  assert.equal(JSON.stringify(STYLE), before, 'MapLibre keeps a reference to what it is handed')
})

test('water is told apart from land', () => {
  assert.equal(find('water').paint['fill-color'], T.water)
  assert.equal(find('water').paint['fill-opacity'], 1)
  assert.equal(find('landuse_residential').paint['fill-color'], T.land2)
  assert.equal(find('background').paint['background-color'], T.land)
})

test('the waterway LINE is toned separately from the water fill', () => {
  assert.equal(find('waterway').paint['line-color'], T.waterLine)
  assert.notEqual(find('waterway').paint['line-color'], find('water').paint['fill-color'])
})

test('parks and woodland are MOSS, and are NOT the land colour', () => {
  assert.equal(find('park').paint['fill-color'], T.natural)
  assert.equal(find('landcover_wood').paint['fill-color'], T.natural)
  assert.notEqual(find('park').paint['fill-color'], T.land2)
})

test('major roads, casings and minor roads are three different weights', () => {
  const major = find('highway_major_inner').paint['line-color']
  const casing = find('highway_motorway_casing').paint['line-color']
  const minor = find('highway_minor').paint['line-color']
  assert.equal(major, T.roadMajor)
  assert.equal(casing, T.roadCasing)
  assert.equal(minor, T.roadMinor)
  assert.equal(new Set([major, casing, minor]).size, 3,
    'the Strip cannot read as a spine if all roads are one colour')
  assert.equal(find('railway').paint['line-color'], T.roadMinor)
  assert.equal(find('boundary_2').paint['line-color'], T.boundary)
})

test('the tiles\' own buildings stay quiet, since we extrude our own', () => {
  assert.equal(find('building').paint['fill-color'], T.building)
  assert.equal(find('building').paint['fill-outline-color'], T.buildingEdge)
  assert.equal(find('building').paint['fill-antialias'], true, 'not ours to change')
})

test('NO UPSTREAM COLOUR SURVIVES on a layer we claim to have recoloured', () => {
  /* The guard that would have caught the white mesh without anyone looking at
     the map. Positron is a LIGHT theme: every colour it ships is wrong for us,
     so any `*-color` still holding its original value on a painted layer is a
     leak — regardless of whether we thought to override that particular
     property. Checking our own tokens can only ever find mistakes we already
     imagined. */
  const before = new Map(STYLE.layers.map((l) => [l.id, { ...(l.paint ?? {}) }]))
  for (const l of out().layers) {
    if (classifyLayer(l) === 'other') continue
    for (const [k, v] of Object.entries(l.paint ?? {})) {
      if (!k.endsWith('-color')) continue
      const was = before.get(l.id)[k]
      assert.ok(was === undefined || was !== v,
        `${l.id}.${k} still holds Positron's ${JSON.stringify(was)} — a light-theme colour we never chose`)
    }
  }
})

test('labels stay neutral paper on a land-coloured halo', () => {
  for (const id of ['label_city', 'water_name_point_label']) {
    assert.equal(find(id).paint['text-color'], T.dim)
    assert.equal(find(id).paint['text-halo-color'], T.land, 'the halo is what contrast is measured against')
    assert.equal(find(id).paint['text-halo-width'], 1.2)
  }
})

test('route shields are muted — a sprite cannot be recoloured, only dimmed', () => {
  const shield = find('highway-shield-us-interstate')
  assert.ok(shield.paint['icon-opacity'] < 1,
    'Positron ships pure-white shields; measured, they were the brightest pixels on the map')
  assert.equal(find('label_city').paint['icon-opacity'], undefined, 'plain labels have no icon to dim')
})

test('existing paint properties survive', () => {
  // A transform that replaced `paint` wholesale would silently drop line-width
  // and the map would look subtly wrong with nothing failing.
  assert.equal(find('highway_minor').paint['line-width'], 3, 'widths are not ours to change')
})

test('an unknown layer type is left alone rather than guessed at', () => {
  assert.deepEqual(find('odd').paint, { 'heatmap-radius': 9 })
  assert.equal(classifyLayer({ id: 'odd', type: 'heatmap' }), 'other')
})

test('a style with no layers does not throw', () => {
  assert.deepEqual(applyPalette({}, T).layers, [])
})

test('paletteCoverage counts by class and invents nothing', () => {
  const c = paletteCoverage(STYLE)
  assert.equal(c.total, STYLE.layers.length)
  assert.equal(c.recoloured + c.untouched, c.total)
  assert.equal(c.untouched, 1, 'only the heatmap is untouched')
  assert.equal(c.byClass['fill-extrusion'], undefined,
    'Positron has no fill-extrusion layer; the old count implied it did')
  assert.equal(c.byClass.label, 2)
  assert.equal(c.byClass.shield, 1, 'shields are split from labels: a sprite is not a colour')
  assert.equal(c.byClass.water, 2, 'the water fill and the waterway line')
  assert.equal(c.byClass.natural, 2)
})

/* ---------- the rules, against the REAL palette ---------- */

test('RULE: water cannot be mistaken for the SELECTION PIN', () => {
  /* RESTATED, NOT RELAXED — 2026-08-09. This asked for a hue gap from the teal
     that meant verified. No colour means verified any more, so that gap is
     unmeasurable (--cid-value is a tombstone resolving to --cid-text) and the
     question it was really asking has moved: the only thing left on this map
     that CARRIES meaning is the selection pin, and the ground is now the same
     blue family as the pin, so hue can no longer be the separator.
     Lightness and chroma are, and they are the honest ones here: water is a
     dark, quiet field; the pin is a bright, saturated mark. */
  const pin = C('--cid-accent-500')
  for (const name of ['--cid-map-water', '--cid-map-water-line']) {
    const c = C(name)
    assert.ok(c.b > c.g && c.b > c.r, `${name} is not blue-dominant`)
    assert.ok(luminance(c) < luminance(pin) / 3,
      `${name} is bright enough to compete with the selection pin`)
    assert.ok(chroma(c) < chroma(pin),
      `${name} is more saturated than the pin — the mark must always win the saturation`)
  }
})

test('RULE: the MARK always wins the saturated value', () => {
  /* RESTATED — 2026-08-09, and this is the one the palette swap genuinely
     invalidated rather than merely renamed. The old test let a ground colour
     pass by being far from the signal in HUE. That worked while the ground was
     aubergine and the signal was teal — two families. The steel ground is now
     the SAME FAMILY as the selection pin (land-2 sits 1 degree from it), so hue
     can no longer separate anything here and a hue-based pass would be
     measuring nothing.
     What survives is the principle the water comment always stated: the data
     signal wins the saturated value. On a one-family map that is the whole
     guard — the mark is the most saturated thing on screen, and the ground is
     allowed real colour only while it stays clearly below it. Luminance is
     asserted separately by 'figure over ground'.
     Headroom as measured: the most saturated ground is the waterway at 0.64x
     the pin, and the ground the eye sees most (land) at 0.21x. */
  const pin = C('--cid-accent-500')
  const pc = chroma(pin)
  for (const name of GROUND) {
    const c = C(name)
    assert.ok(chroma(c) < pc * 0.75,
      `${name} reaches ${(chroma(c) / pc * 100).toFixed(0)}% of the selection pin's saturation `
      + `(chroma ${chroma(c).toFixed(3)} vs ${pc.toFixed(3)}) — the ground is competing with the mark`)
  }
})

test('RULE: figure over ground — no ground colour outshines a building', () => {
  const building = luminance(C('--cid-accent-500'))
  for (const name of GROUND) {
    const l = luminance(C(name))
    assert.ok(l < building,
      `${name} (${l.toFixed(3)}) is at least as bright as the buildings (${building.toFixed(3)}) — the towers stop reading`)
  }
})

test('RULE: the land base is TINTED toward the brand, not neutral and not warm', () => {
  /* RESTATED — 2026-08-09. This asserted `c.b > c.g` and called it
     "aubergine-tinted". Steel blue satisfies that trivially, so after the swap
     the test PASSED while proving nothing: every blue passes, and the thing it
     named no longer exists. A guard that cannot fail is not a guard.
     The real requirement is that the ground is a deliberate tint of the brand
     family rather than a neutral grey the eye reads as unstyled — and that it
     never drifts warm, because warm ground would put the map's own floor into
     the gold band the cage lives in. */
  for (const name of ['--cid-map-land', '--cid-map-land-2']) {
    const c = C(name)
    assert.ok(c.b > c.g && c.b > c.r, `${name} is not blue-dominant — the ground has left the brand family`)
    assert.ok(chroma(c) > 0.03, `${name} has chroma ${chroma(c).toFixed(3)} — that is a neutral grey, not a tint`)
    assert.ok(hueGap(c, C('--cid-gold-500')) > 60, `${name} has drifted warm, toward the cage's own band`)
  }
})

test('RULE: the map is one family in lightness steps, land -> roads -> buildings', () => {
  /* The chain survived two reversals of what colour the roads are, which is why
     it is the rule worth keeping: it constrains STRUCTURE, not hue. */
  const chain = ['--cid-map-road-minor', '--cid-map-road-casing', '--cid-map-road-major']
  const ls = chain.map((n) => luminance(C(n)))
  for (let i = 1; i < ls.length; i++) {
    assert.ok(ls[i] > ls[i - 1], `${chain[i]} is not brighter than ${chain[i - 1]} — the Strip cannot read as a spine`)
  }
  assert.ok(ls.at(-1) < luminance(C('--cid-accent-500')),
    'the road network outshines a lit building')
  assert.ok(ls[0] > luminance(C('--cid-map-land-2')),
    'the quietest road is not above the land it sits on — the network has no step to stand in')

  /* THE MULTI-SHADE DEPTH BAND, PINNED ABOVE THE DIM COLOUR — 2026-08-09.
     Three surfaces now carry three shades (base/edge, shell, roof ring) so a
     mass reads as a solid rather than a silhouette. The shading is by SURFACE,
     never by data: nothing here varies with height or with any figure, because
     a taller building is not a different colour, it is a taller building.
     THE HARD FLOOR is that the DARKEST lit shade still separates from the
     dimmed mass. Depth is worthless if the price is a lit building that reads
     as filtered out, and that is the one thing this band could silently buy —
     so it is the one thing asserted. The separation it must hold is the one the
     aubergine ladder measured (12.9 L* / 1.61:1); the steel ladder reproduces
     it at 12.7 / 1.60. */
  const shades = ['--cid-map-building-lit', '--cid-map-shell-lit', '--cid-map-roof-lit']
  const dim = luminance(C('--cid-map-mass-dim'))
  const shadeL = shades.map((n) => luminance(C(n)))
  for (let i = 0; i < shades.length; i++) {
    assert.ok(shadeL[i] > dim,
      `${shades[i]} is not above --cid-map-mass-dim — a lit surface is reading as filtered out`)
  }
  for (let i = 1; i < shades.length; i++) {
    assert.ok(shadeL[i] > shadeL[i - 1],
      `${shades[i]} is not brighter than ${shades[i - 1]} — the three surfaces are not three shades`)
  }
  /* Compared on the parsed CHANNELS, not on a `.hex` property — parseColour
     does not return one, so the first version of this line built a Set of three
     `undefined`s and asserted 1 !== 3. It failed loudly, which is the only
     reason it was caught: a Set of undefined would have reported size 1 and
     "passed" just as readily against a different expected value. */
  const triples = shades.map((n) => { const c = C(n); return `${c.r},${c.g},${c.b}` })
  assert.equal(new Set(triples).size, 3,
    `the depth band collapsed to fewer than three distinct shades — ${triples.join(' / ')}`)
})

test('RULE: gold outlines the arterials, it does not BE them', () => {
  /* Narrowed again, and the boundary has moved from "which roads" to "which
     part of a road". The casing is drawn WIDER than the body (Positron: 3 vs 2
     at z10), so a gold casing under a steel-blue body shows as an edge down
     each side — a line. The BODY is the surface, and it stays blue. */
  const body = C('--cid-map-road-major')
  assert.ok(body.b > body.r, '--cid-map-road-major is warm — gold has taken the road itself, not its outline')
  assert.ok(hueGap(C('--cid-map-road-casing'), C('--cid-gold-500')) < 30,
    'the arterial casing is meant to be gold — that is the outline Phil asked for')
  assert.ok(luminance(C('--cid-map-road-casing')) < luminance(body),
    'the casing outshines the body it frames')
})

test('RULE: gold never reaches a FILL, which is a surface by definition', () => {
  /* Narrowed, not dropped. Gold had the WHOLE network for one pass and read as
     a surface; it now has the minor grid, where it is thin, dim and held below
     the casing. The boundary that matters is which roads: casing and major are
     the continuous arterials that form a shape across the frame, and those are
     what a surface is made of. The fine grid is texture.
     Purple is blue-dominant and gold is red-dominant, so the line is drawn by
     channel rather than by anyone remembering the reasoning. */
  assert.ok(hueGap(C('--cid-map-road-minor'), C('--cid-gold-500')) < 30,
    'the minor grid is meant to be gold — if it is not, the map is back to one hue')
  /* Hue distance, not channel dominance: the fills are three different families
     now (steel, moss, deep blue) and only ONE of them is NOT blue-dominant. A
     channel test would have demanded moss be blue, which is a rule about the
     wrong thing. What matters is that no FILL is gold. */
  for (const name of ['--cid-map-land', '--cid-map-land-2', '--cid-map-building', '--cid-map-natural', '--cid-map-water']) {
    assert.ok(hueGap(C(name), C('--cid-gold-500')) > 40,
      `${name} is only ${hueGap(C(name), C('--cid-gold-500')).toFixed(0)}° from gold — gold has reached a FILL, which is a surface by definition`)
  }
})

test('RULE: the gold minor grid is held at texture weight', () => {
  /* The only defence against a thin line becoming a field is how strongly it is
     drawn, so the opacity is asserted rather than left to a comment. Positron
     ships these at 0.9, which was a gold field in the dense blocks. */
  const minor = find('highway_minor')
  assert.ok(minor.paint['line-opacity'] <= 0.6,
    `minor roads at ${minor.paint['line-opacity']} opacity — gold this dense reads as a surface, not texture`)
  assert.equal(find('highway_major_inner').paint['line-opacity'], undefined,
    'the arterials are steel blue and need no damping')
})

test('RULE: gold survives in the UI chrome, which is where it is rare', () => {
  const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8')
  for (const role of [/\.cid-label \{[^}]*--cid-gold-300/s, /\.cid-thead \{[^}]*--cid-gold-line/s, /^a \{[^}]*--cid-gold-300/ms]) {
    assert.match(css, role, 'gold lost a UI role it was meant to keep')
  }
})

test('RULE: label contrast holds at 4.5:1 against its halo', () => {
  /* Measured against the HALO, not the land: a label crosses water, park and
     road within one pan, so there is no single background to measure. The halo
     is the background the text actually sits on, which makes it the honest
     denominator. */
  const halo = C('--cid-map-land')
  const ratio = contrast(over(C('--cid-dim'), halo), halo)
  assert.ok(ratio >= 4.5, `label contrast is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`)
})

/* ---------- gold: the accent tier ---------- */

/* Every surface gold can land on. Gold is a LIGHT hue on a dark palette, so
   contrast is the thing that breaks first — and it breaks per-surface, not
   globally. */
const SURFACES = ['--cid-ink-800', '--cid-ink-700', '--cid-ink-600', '--cid-ink-500']
/* Split by ROLE, because the answer differs: text must clear 4.5:1, a hairline
   or a fill need only be visible. */
const GOLD_TEXT = ['--cid-gold-300', '--cid-gold-200']
const GOLD_FILL = ['--cid-gold-700', '--cid-gold-500']

test('RULE: gold TEXT clears 4.5:1 on every surface it can land on', () => {
  for (const g of GOLD_TEXT) {
    for (const bg of SURFACES) {
      const r = contrast(C(g), C(bg))
      assert.ok(r >= 4.5, `${g} on ${bg} is ${r.toFixed(2)}:1 — below the floor`)
    }
  }
})

test('RULE: fill-only gold is NEVER used as a text colour', () => {
  /* --cid-gold-700 is 3.9:1 on the page and would fail as text. Rather than
     trusting the comment beside it, this reads the stylesheets: a `color:`
     referencing a fill-only token is the mistake, and it is the kind that gets
     made by someone reaching for "the gold one". */
  const css = ['../app/globals.css', '../app/styles/styles.css']
    .map((f) => readFileSync(join(import.meta.dirname, f), 'utf8')).join('\n')
  for (const g of GOLD_FILL) {
    const m = css.match(new RegExp(`(^|[^-])color:\\s*var\\(${g}\\)`, 'm'))
    assert.equal(m, null, `${g} is used as a text colour and does not meet 4.5:1`)
  }
})

test('RULE: gold is never semantic — the state colours are untouched', () => {
  /* The load-bearing rule. Teal still and only means verified; "not yet
     confirmed" stays NEUTRAL GREY and must not drift to ochre now that gold is
     in the palette — an ochre flag would sit one step from the decoration and
     one step from a warning, which is the worst place for a state to live. */
  const unverified = C('--cid-unverified')
  /* RESTATED AS A HUE GUARD — 2026-08-09. This was `chroma < 0.02`, which
     encoded "stay a NEUTRAL grey" as the way to satisfy "never drift to ochre".
     The steel palette's unverified is a COOL grey (#8FA2B8, chroma 0.161): it
     moves the opposite way round the wheel from ochre and satisfies the intent
     while failing the old letter. So the guard now states the intent itself —
     distance from the warm band — which a neutral grey also passes and an ochre
     never can, whatever its chroma. */
  assert.ok(hueGap(unverified, C('--cid-gold-500')) > 120,
    `--cid-unverified sits ${hueGap(unverified, C('--cid-gold-500')).toFixed(0)}° from gold — `
    + 'it has drifted warm, which is the ochre failure this guard exists for')
  /* Gold must stay clear of THE ACTION, which is the claim it could still be
     confused with. It used to be measured against the verified colour; there is
     no longer one, and gold carrying no meaning is now a law rather than a
     measurement. */
  for (const g of [...GOLD_TEXT, ...GOLD_FILL]) {
    assert.ok(hueGap(C(g), C('--cid-accent-300')) > 60,
      `${g} is too close in hue to the one filled action`)
  }
})

test('RULE: BLUE keeps the commitment role, gold does not take it', () => {
  /* The one filled action per screen is blue. Gold could not take it even if
     the law allowed: paper on the decorative gold measures 1.53:1, so a gold
     FILL behind paper text is unreadable — the rule and the physics agree. */
  const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8')
  assert.match(css, /background: var\(--cid-accent-700\)/, 'the filled action lost its blue')
  assert.ok(!/background: var\(--cid-gold-(500|700)\)/.test(css), 'gold has taken a filled action')
})

test('RULE: --cid-accent-300 is reserved for hover and the lit edge', () => {
  /* It was the resting link colour AND the value reserved for hover, which
     cannot both be true. Links moved to gold so the reservation is real. The
     hex moved with the palette (#A98CE8 -> #7FB0E8); the reservation is on the
     TOKEN, which is why this survived the swap untouched. */
  const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8')
  const resting = css.match(/^a \{[^}]*\}/ms)?.[0] ?? ''
  assert.ok(!resting.includes('--cid-accent-300'), 'the resting link still uses the hover-reserved value')
  assert.match(css, /a:hover \{[^}]*--cid-accent-300/, 'hover does not use the value reserved for it')
})

test('RULE: the map gold is dimmed WITHOUT touching the UI gold', () => {
  /* Phil asked for the gold at about half brightness. Halving the shared scale
     would have taken the section eyebrows and links below their 4.5:1 floor, so
     the dimming is scoped to --cid-map-*. Both halves are asserted: the map
     gold really is about half, and the UI gold is untouched — a "dimming" that
     quietly dimmed neither would look identical to one that dimmed both. */
  const ui = luminance(C('--cid-gold-500'))
  const map = luminance(C('--cid-map-building-lit'))
  assert.ok(map < ui * 0.6, `map gold is ${(map / ui * 100).toFixed(0)}% of the UI gold — not dimmed`)
  assert.ok(map > ui * 0.25, `map gold is ${(map / ui * 100).toFixed(0)}% of the UI gold — dimmed past "about half"`)
  for (const g of GOLD_TEXT) {
    for (const bg of SURFACES) {
      assert.ok(contrast(C(g), C(bg)) >= 4.5, `${g} on ${bg} fell below the floor — the dimming leaked into the UI scale`)
    }
  }
})

test('RULE: hover is gold, and is NOT the colour that means verified', () => {
  /* A CAUGHT REGRESSION, not a preference. Hover was --cid-value: the teal that
     means verified, spent on decoration. It is the same mistake as an ochre
     "unverified" — a hue that carries a claim, used where nothing is being
     claimed — and it shipped because nothing asserted that the map's decorative
     colours stay clear of the semantic ones. */
  const hover = C('--cid-map-hover')
  /* RESTATED — 2026-08-09. The regression this caught was hover spending the
     colour that meant verified. Nothing means verified now, so the live risk
     moved to the other end: hover must not spend the SELECTION colour either,
     because selection stays blue and a gold hover must claim nothing at all. */
  assert.ok(hueGap(hover, C('--cid-accent-500')) > 60,
    `hover is ${hueGap(hover, C('--cid-accent-500')).toFixed(0)}° from the selection pin — `
    + 'hover must not read as selection')
  assert.ok(hueGap(hover, C('--cid-gold-500')) < 30, 'hover is meant to be gold')
})

test('RULE: hover is the BRIGHT gold, decoration keeps the dim one', () => {
  /* Separated by VALUE, the way brand teal was separated from decorative teal.
     The map gold is dim and covers ~16% of the frame, so a hover drawn in it
     would be invisible — the same colour cannot be both the background texture
     and the thing that stands out of it. */
  const hover = luminance(C('--cid-map-hover'))
  const deco = luminance(C('--cid-map-building-lit'))
  assert.notEqual(token('--cid-map-hover'), token('--cid-map-building-lit'),
    'hover has drifted onto the decoration gold and would vanish into the map')
  assert.ok(hover > deco * 2, `hover is only ${(hover / deco).toFixed(1)}x the decoration gold — it will not read as a hover`)
  assert.ok(hover >= luminance(C('--cid-accent-500')),
    'hover is dimmer than an unhovered building, which inverts what hover means')
})

test('RULE: the SKY joins the luminance chain — a horizon cannot outshine a building', () => {
  /* A sky is the one surface big enough to break "the brightest thing on the map
     is a building or a pin" without anything noticing: it is enormous, it sits
     behind everything, and every existing assertion looked only at ground
     colours. So the horizon glow is held under a lit building and the chain now
     runs sky -> horizon -> roads -> building. */
  const building = luminance(C('--cid-accent-500'))
  const horizon = luminance(C('--cid-map-horizon'))
  const sky = luminance(C('--cid-map-sky'))
  assert.ok(horizon < building,
    `the horizon (${horizon.toFixed(3)}) is at least as bright as a building (${building.toFixed(3)})`)
  assert.ok(sky < horizon, 'the zenith is brighter than the horizon, which is not how dusk works')
  /* The valley haze is a screen-space scrim covering roughly the top half of
     the frame, so it is a large-area surface on exactly the same terms as the
     sky and joins the same chain. */
  const fog = luminance(C('--cid-map-fog'))
  assert.ok(fog < building, `the haze (${fog.toFixed(3)}) is at least as bright as a building`)
  assert.ok(luminance(C('--cid-map-road-major')) < building, 'the chain broke at the arterials')
})

test('RULE: labels stay legible THROUGH THE VALLEY HAZE', () => {
  /* The haze sits OVER the labels at the top of the frame, so the worst case is
     text seen through it: the scrim composited onto the halo, and the text
     against that. Labels near the horizon are exactly where this fails. */
  const halo = C('--cid-map-land')
  const hazed = over({ ...C('--cid-map-fog'), a: 0.9 }, halo)
  const text = over(C('--cid-dim'), halo)
  const r = contrast(text, hazed)
  assert.ok(r >= 4.5, `label text through the haze is ${r.toFixed(2)}:1, below the floor`)
})

test('RULE: labels stay legible AGAINST THE HORIZON, not just against the land', () => {
  /* The failure case for a glowing sky is a label sitting on the bright band
     near the horizon. The halo is land-coloured, so it does not help there —
     this measures the text against the WORST backdrop it can land on rather
     than the one it usually gets. */
  const text = over(C('--cid-dim'), C('--cid-map-land'))
  const r = contrast(text, C('--cid-map-horizon'))
  assert.ok(r >= 4.5, `label text over the horizon glow is ${r.toFixed(2)}:1, below the floor`)
})

test('RULE: the map tokens exist in BOTH themes', () => {
  const light = CSS.slice(LIGHT_AT)
  for (const name of [...GROUND, '--cid-map-boundary', '--cid-map-building-lit', '--cid-map-hover', '--cid-map-sky', '--cid-map-horizon', '--cid-map-fog', '--cid-map-light', ...GOLD_TEXT, ...GOLD_FILL, '--cid-gold-line', '--cid-gold-wash']) {
    assert.ok(light.includes(name), `${name} has no light-theme value — the map would keep dark ground on paper`)
  }
})
