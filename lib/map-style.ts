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
 * Pure on purpose: a transform that takes a style and returns a style can be
 * unit-tested without a browser, which is the only kind of map code that can be.
 */

export type PaletteTokens = {
  base: string
  surface: string
  water: string
  line: string
  dim: string
}

type Layer = {
  id: string
  type: string
  paint?: Record<string, unknown>
  [k: string]: unknown
}
export type MapStyle = { layers?: Layer[]; [k: string]: unknown }

const isWater = (id: string) => /water|ocean|river/i.test(id)

/**
 * Returns a NEW style; the input is not mutated. MapLibre keeps a reference to
 * whatever it is handed, and a shared mutated object is the kind of aliasing
 * bug that shows up two screens away from its cause.
 */
export function applyPalette(style: MapStyle, t: PaletteTokens): MapStyle {
  const layers = (style.layers ?? []).map((l): Layer => {
    const paint = { ...(l.paint ?? {}) }
    const water = isWater(l.id)
    switch (l.type) {
      case 'background':
        paint['background-color'] = t.base
        break
      case 'fill':
        paint['fill-color'] = water ? t.water : t.surface
        paint['fill-opacity'] = water ? 1 : 0.5
        break
      case 'line':
        paint['line-color'] = water ? t.water : t.line
        break
      case 'symbol':
        paint['text-color'] = t.dim
        paint['text-halo-color'] = t.base
        paint['text-halo-width'] = 1.2
        break
      case 'fill-extrusion':
        // The style's own buildings are hidden: we extrude only the 17 casinos
        // we have sourced heights for, from our own polygons.
        paint['fill-extrusion-opacity'] = 0
        break
      default:
        break
    }
    return { ...l, paint }
  })
  return { ...style, layers }
}

/** How many layers the transform touched — reported rather than assumed, so a
 *  style that silently changes shape upstream is visible rather than quiet. */
export function paletteCoverage(style: MapStyle) {
  const layers = style.layers ?? []
  const handled = layers.filter((l) =>
    ['background', 'fill', 'line', 'symbol', 'fill-extrusion'].includes(l.type))
  return { total: layers.length, recoloured: handled.length, untouched: layers.length - handled.length }
}
