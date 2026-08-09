/**
 * The sanctioned way to get a palette value into JavaScript.
 *
 * Some APIs cannot take a CSS variable — canvas `fillStyle`, WebGL uniforms, a
 * Leaflet style callback, an OG image generator. Those are exactly the places a
 * hardcoded hex gets typed "just this once", and exactly why the lint rule
 * would otherwise be disabled rather than obeyed. So: read the token once at
 * init and hold the resolved value.
 *
 * The rule this preserves is that `colors.css` stays the single source of the
 * palette. Change a token there and the canvas follows on next load; type a hex
 * into the canvas and it silently stops tracking.
 */

/** Resolve one `--cid-*` custom property against the document root. */
export function readToken(name: string, fallbackEl?: Element): string {
  if (typeof window === 'undefined') {
    throw new Error('readToken is client-only — computed styles do not exist on the server.')
  }
  const el = fallbackEl ?? document.documentElement
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  if (!value) {
    // Silently returning '' paints transparent and looks like a rendering bug
    // rather than a missing token, so fail loudly instead.
    throw new Error(`Token ${name} is not defined — is app/styles/tokens/colors.css loaded?`)
  }
  return value
}

/** Read a whole palette in one pass, for a module that paints many colours. */
export function readTokens<K extends string>(names: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>
  for (const key of Object.keys(names) as K[]) out[key] = readToken(names[key])
  return out
}

/**
 * Every colour the map paints, named here rather than inside the map so the
 * whole palette is reviewable in one place — and so a new colour has to be
 * ADDED here rather than typed inline, which the no-raw-colour lint rule then
 * enforces. MapLibre restyles each style layer individually, so it needs more
 * of these than the Leaflet map did: that one toned raster tiles with a single
 * CSS filter.
 */
export const MAP_TOKENS = {
  pin: '--cid-pin',
  pinDim: '--cid-pin-dim',
  clusterPartial: '--cid-cluster-partial',
  accent: '--cid-accent-700',
  accent300: '--cid-accent-300',
  accentDeep: '--cid-accent-900',
  scrim: '--cid-scrim',
  base: '--cid-ink-800',
  surface: '--cid-ink-700',
  raised: '--cid-ink-600',
  line: '--cid-line-2',
  /* GROUND MAP. Separate from the ink scale on purpose: these are tinted
     toward the accent, and reusing --cid-ink-* would have quietly changed the
     panels and popups too. */
  land: '--cid-map-land',
  land2: '--cid-map-land-2',
  natural: '--cid-map-natural',
  water: '--cid-map-water',
  waterLine: '--cid-map-water-line',
  building: '--cid-map-building',
  buildingEdge: '--cid-map-building-edge',
  buildingLit: '--cid-map-building-lit',
  /* MULTI-SHADE DEPTH — by SURFACE, never by data. The cage is one gold
     family at three steps so a mass reads as a solid: the base line sits in
     shadow (buildingLit), the shell catches raking light, the roof ring
     faces the sky. Nothing here varies with height or any figure. */
  shellLit: '--cid-map-shell-lit',
  roofLit: '--cid-map-roof-lit',
  hover: '--cid-map-hover',
  massDim: '--cid-map-mass-dim',
  /* The third filter state. Neutral by design — see the token's note. */
  massUnknown: '--cid-map-mass-unknown',
  pinUnknown: '--cid-pin-unknown',
  litDim: '--cid-map-lit-dim',
  sky: '--cid-map-sky',
  horizon: '--cid-map-horizon',
  fog: '--cid-map-fog',
  light: '--cid-map-light',
  roadMinor: '--cid-map-road-minor',
  roadCasing: '--cid-map-road-casing',
  roadMajor: '--cid-map-road-major',
  boundary: '--cid-map-boundary',
  /* Used ONLY by the NEXT_PUBLIC_MAP_STRIP_GOLD comparison flag, never by the
     default basemap. gold-700 is the fill-only step, and it is darker than a
     lit building, so even the option keeps brightness with the buildings. */
  stripGold: '--cid-gold-700',
  dim: '--cid-dim',
  text: '--cid-text',
  /* --cid-value is deliberately ABSENT. It was here only to paint the map's
     hover, which spent the colour that means "verified" on decoration. Nothing
     on the map states verification yet; when something does, it comes back. */
} as const
