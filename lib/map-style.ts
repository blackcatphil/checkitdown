/**
 * Recolour a MapLibre style to the locked palette BEFORE the map is
 * constructed.
 *
 * The first version walked the style after `load` and called
 * `setPaintProperty` — **83 calls across 55 layers**, every one against a map
 * that was already live, each triggering a style diff and a repaint. MapLibre
 * fetches the style JSON anyway; fetching it ourselves, transforming the object
 * and handing the result to the constructor costs the same request and does the
 * work once.
 *
 * (That change was once credited with fixing the map's load time. It did not:
 * the map had no worker and never requested a tile. It is kept on its own
 * merits. See docs/README.md.)
 *
 * TWO RULES GOVERN THE COLOURS, and both are about meaning rather than taste:
 *
 * 1. **Saturation carries meaning, so decoration gets the desaturated end.**
 *    `--cid-value` (#4FBFAE) means verified. Water is the same family at a
 *    fraction of the saturation, so it never competes for that signal. Where a
 *    map layer and a data signal could sit adjacent, the data signal wins the
 *    saturated value.
 * 2. **Aubergine goes in the shadows, not the highlights.** The buildings are
 *    the figure; the ground map is the ground. Tint the dark end and leave the
 *    light end near-neutral, so nothing on the ground outshines a tower.
 *
 * Pure on purpose: a transform that takes a style and returns a style can be
 * unit-tested without a browser, which is the only kind of map code that can be.
 */

export type PaletteTokens = {
  land: string
  land2: string
  natural: string
  water: string
  waterLine: string
  building: string
  buildingEdge: string
  roadMinor: string
  roadCasing: string
  roadMajor: string
  boundary: string
  dim: string
}

type Layer = {
  id: string
  type: string
  paint?: Record<string, unknown>
  [k: string]: unknown
}
export type MapStyle = { layers?: Layer[]; [k: string]: unknown }

/**
 * What a layer IS, decided once so the paint switch below reads as intent
 * rather than as a pile of regexes.
 *
 * Classified against the REAL layer list of the style we ship (55 layers in
 * OpenFreeMap Positron: 1 background, 9 fill, 26 line, 19 symbol), not against
 * guessed naming conventions — this project has picked the wrong polygon by
 * pattern-match more than once. `other` is a real answer, and layers that land
 * there keep their upstream paint rather than being coloured on a guess.
 */
export type LayerClass =
  | 'background' | 'water' | 'natural' | 'land' | 'building'
  | 'road-major' | 'road-casing' | 'road-minor' | 'boundary' | 'label' | 'shield' | 'other'

export function classifyLayer(layer: Pick<Layer, 'id' | 'type'>): LayerClass {
  const id = layer.id.toLowerCase()

  if (layer.type === 'background') return 'background'
  /* Labels first: every symbol layer is a label, including the water ones, and
     they stay neutral paper regardless of what they sit on. Route shields are
     split out because they are a SPRITE IMAGE, not a colour we can set. */
  if (layer.type === 'symbol') return /shield/.test(id) ? 'shield' : 'label'
  if (/boundary|admin/.test(id)) return 'boundary'
  /* `waterway` contains "water", so water wins before anything else can claim
     it — and the waterway LINE is toned separately from the water fill. */
  if (/water|ocean|river|sea\b|bay/.test(id)) {
    return layer.type === 'line' ? 'water' : 'water'
  }
  if (/park|wood|forest|grass|glacier|ice_shelf|golf|cemetery|pitch|sand|scrub/.test(id)) return 'natural'
  if (/building/.test(id)) return 'building'

  if (layer.type === 'line') {
    /* Casing before major: `highway_motorway_casing` matches both, and the
       casing is the frame rather than the body. */
    if (/casing/.test(id)) return 'road-casing'
    if (/motorway|major|trunk|primary/.test(id)) return 'road-major'
    if (/highway|road|street|rail|transit|aeroway|taxiway|runway|path|pier|ferry/.test(id)) return 'road-minor'
    return 'other'
  }
  if (layer.type === 'fill') return 'land'
  return 'other'
}

/** The classes this transform actually paints. `other` and unknown types keep
 *  whatever the upstream style gave them. */
const PAINTED: ReadonlySet<LayerClass> = new Set<LayerClass>([
  'background', 'water', 'natural', 'land', 'building',
  'road-major', 'road-casing', 'road-minor', 'boundary', 'label', 'shield',
])

/* Positron's route shields are raster sprites, so `icon-color` does nothing —
   opacity is the only lever. At full strength they render PURE WHITE, which
   measured as the brightest thing on the map: brighter than the buildings, on
   the least important content in the view. Muted rather than hidden, because
   I-15 and Las Vegas Blvd are real wayfinding. */
const SHIELD_OPACITY = 0.5

/**
 * Returns a NEW style; the input is not mutated. MapLibre keeps a reference to
 * whatever it is handed, and a shared mutated object is the kind of aliasing
 * bug that shows up two screens away from its cause.
 */
export function applyPalette(style: MapStyle, t: PaletteTokens): MapStyle {
  const layers = (style.layers ?? []).map((l): Layer => {
    const paint = { ...(l.paint ?? {}) }
    const cls = classifyLayer(l)

    switch (cls) {
      case 'background':
        paint['background-color'] = t.land
        break

      case 'water':
        /* Fully opaque so depth reads as its own mass rather than as land seen
           through a film. The waterway LINE gets the lighter of the pair. */
        if (l.type === 'line') paint['line-color'] = t.waterLine
        else {
          paint['fill-color'] = t.water
          paint['fill-outline-color'] = t.water
          paint['fill-opacity'] = 1
        }
        break

      case 'natural':
        /* AUBERGINE, NOT GREEN. The palette bans green-as-good, and the Wynn
           golf course rendering green beside a teal "verified" marker would be
           a visible contradiction of that rule on the product's front page. */
        if (l.type === 'line') paint['line-color'] = t.natural
        else {
          paint['fill-color'] = t.natural
          paint['fill-outline-color'] = t.natural
          paint['fill-opacity'] = 1
        }
        break

      case 'land':
        paint['fill-color'] = t.land2
        paint['fill-outline-color'] = t.land2
        paint['fill-opacity'] = 1
        break

      case 'building':
        /* The tiles' own buildings stay as quiet texture. They are NOT the
           extrusions — those come from our own footprints — and if they
           brightened toward the accent they would compete with the 16 masses
           that are the point of the view. */
        paint['fill-color'] = t.building
        /* THE HAIRLINE POSITRON SHIPS IS rgb(219,219,218) — near-white, and the
           only `fill-outline-color` in the whole style. Setting fill-color and
           leaving it produced a white mesh over every block in the valley: the
           BRIGHTEST thing on the map, on a layer meant to be quiet texture,
           straight through a figure/ground rule that only ever inspected our
           own tokens. A colour we never chose cannot be caught by checking the
           colours we chose. */
        paint['fill-outline-color'] = t.buildingEdge
        paint['fill-opacity'] = 1
        break

      case 'road-major':
        paint['line-color'] = t.roadMajor
        break
      case 'road-casing':
        paint['line-color'] = t.roadCasing
        break
      case 'road-minor':
        paint['line-color'] = t.roadMinor
        break
      case 'boundary':
        paint['line-color'] = t.boundary
        break

      case 'shield':
        paint['icon-opacity'] = SHIELD_OPACITY
        paint['text-color'] = t.dim
        paint['text-halo-color'] = t.land
        paint['text-halo-width'] = 1.2
        break

      case 'label':
        /* Unchanged in intent: neutral paper on a halo of the land colour. The
           halo is what the contrast invariant is measured against, because a
           label crosses water, park and road within one pan — there is no
           single background to measure. */
        paint['text-color'] = t.dim
        paint['text-halo-color'] = t.land
        paint['text-halo-width'] = 1.2
        break

      default:
        break
    }
    return { ...l, paint }
  })
  return { ...style, layers }
}

/**
 * What the transform touched, BY CLASS — reported rather than assumed, so a
 * style that silently changes shape upstream is visible rather than quiet.
 *
 * The old version counted layer TYPES and reported `fill-extrusion` among them.
 * Positron has no fill-extrusion layer at all, so that arm never once ran while
 * the count implied it had: a coverage number that was wrong in the direction
 * of looking thorough.
 */
export function paletteCoverage(style: MapStyle) {
  const layers = style.layers ?? []
  const byClass = {} as Record<LayerClass, number>
  let recoloured = 0
  for (const l of layers) {
    const cls = classifyLayer(l)
    byClass[cls] = (byClass[cls] ?? 0) + 1
    if (PAINTED.has(cls)) recoloured++
  }
  return { total: layers.length, recoloured, untouched: layers.length - recoloured, byClass }
}
