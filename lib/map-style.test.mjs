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

function token(name) {
  const m = DARK.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  assert.ok(m, `${name} is not defined in colors.css`)
  return m[1].trim()
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
 * with a faint blue lean scored 0.34 against vivid #4FBFAE's 0.47 and read as a
 * rival when it was barely a colour at all. "Does this compete with the teal
 * that means verified?" is a question about absolute colour, so it needs an
 * absolute measure.
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
  roadMinor: '#2A2338',
  roadCasing: '#3B3150',
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

test('parks and woodland are aubergine-tinted, and are NOT the land colour', () => {
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

test('RULE: water is INDIGO, moved off the teal it used to share a family with', () => {
  /* Water was a desaturated teal-slate, kept safe only by having very little
     chroma — one nudge from competing with the colour that means verified.
     Indigo removes the question instead of managing it: hue does the work, so
     the water can carry real colour without ever reading as a signal. */
  const value = C('--cid-value')
  for (const name of ['--cid-map-water', '--cid-map-water-line']) {
    const c = C(name)
    assert.ok(c.b > c.g && c.b > c.r, `${name} is not blue-dominant`)
    assert.ok(hueGap(c, value) > 60,
      `${name} is only ${hueGap(c, value).toFixed(0)}° from --cid-value — indigo exists to make that gap large`)
  }
})

test('RULE: no ground colour can be mistaken for the verified teal', () => {
  /* This replaces a blanket "nothing may be green", which over-read the rule and
     would now forbid the briefed moss parks. What the palette actually bans is
     green meaning GOOD — a park is not a claim about anything. So the test
     states the real requirement: a ground colour is safe if it is far from the
     signal in HUE, or too faint in CHROMA to read as a signal at all. Moss
     passes on chroma, indigo water on both. */
  const value = C('--cid-value')
  const vc = chroma(value)
  for (const name of GROUND) {
    const c = C(name)
    const faint = chroma(c) < vc / 3
    const distinct = hueGap(c, value) > 40
    assert.ok(faint || distinct,
      `${name} sits at hue ${hue(c).toFixed(0)}° / chroma ${chroma(c).toFixed(3)}, `
      + `close enough to --cid-value (${hue(value).toFixed(0)}° / ${vc.toFixed(3)}) to read as "verified"`)
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

test('RULE: the land base stays aubergine-tinted', () => {
  for (const name of ['--cid-map-land', '--cid-map-land-2']) {
    const c = C(name)
    assert.ok(c.b > c.g, `${name} is not tinted toward aubergine at all`)
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
})

test('RULE: there is NO GOLD ON THE BASEMAP', () => {
  /* Gold had the whole road network for one pass. Every luminance assertion
     passed and the hierarchy still inverted, because "is it darker than a
     building" cannot see "how much of the frame is it" — a network is a
     surface, and a surface cannot be an accent.
     Purple is blue-dominant and gold is red-dominant, so the two are told apart
     by channel rather than by anyone remembering the rule. */
  for (const name of GROUND) {
    const c = C(name)
    if (name.includes('natural') || name.includes('water')) continue
    assert.ok(c.b >= c.r, `${name} is warm-dominant — gold has got back onto the basemap`)
  }
  const goldHue = hue(C('--cid-gold-500'))
  for (const name of ['--cid-map-road-minor', '--cid-map-road-casing', '--cid-map-road-major']) {
    assert.ok(hueGap(C(name), C('--cid-gold-500')) > 90,
      `${name} sits ${hueGap(C(name), C('--cid-gold-500')).toFixed(0)}° from gold (${goldHue.toFixed(0)}°) — the network must not read as gold`)
  }
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
  assert.ok(chroma(unverified) < 0.02,
    `--cid-unverified has chroma ${chroma(unverified).toFixed(3)} — it must stay neutral grey, not become ochre`)
  const value = C('--cid-value')
  for (const g of [...GOLD_TEXT, ...GOLD_FILL]) {
    assert.ok(hueGap(C(g), value) > 60, `${g} is too close in hue to the colour that means verified`)
  }
})

test('RULE: aubergine keeps the commitment role, gold does not take it', () => {
  /* The one filled action per screen is still aubergine. A gold FILL behind
     paper text would not be readable anyway, which is a second reason the
     commitment colour cannot drift. */
  const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8')
  assert.match(css, /background: var\(--cid-accent-700\)/, 'the filled action lost its aubergine')
  assert.ok(!/background: var\(--cid-gold-(500|700)\)/.test(css), 'gold has taken a filled action')
})

test('RULE: #A98CE8 is reserved for hover', () => {
  /* It was the resting link colour AND the value reserved for hover, which
     cannot both be true. Links moved to gold so the reservation is real. */
  const css = readFileSync(join(import.meta.dirname, '../app/globals.css'), 'utf8')
  const resting = css.match(/^a \{[^}]*\}/ms)?.[0] ?? ''
  assert.ok(!resting.includes('--cid-accent-300'), 'the resting link still uses the hover-reserved value')
  assert.match(css, /a:hover \{[^}]*--cid-accent-300/, 'hover does not use the value reserved for it')
})

test('RULE: the map tokens exist in BOTH themes', () => {
  const light = CSS.slice(LIGHT_AT)
  for (const name of [...GROUND, '--cid-map-boundary', ...GOLD_TEXT, ...GOLD_FILL, '--cid-gold-line', '--cid-gold-wash']) {
    assert.ok(light.includes(name), `${name} has no light-theme value — the map would keep dark ground on paper`)
  }
})
