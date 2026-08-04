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
 * What the 3D map module needs when it is wired in. Named here rather than in
 * the module so the map's palette is reviewable alongside the rest.
 */
export const MAP_TOKENS = {
  pin: '--cid-pin',
  accentDeep: '--cid-accent-900',
  pinDim: '--cid-pin-dim',
  clusterPartial: '--cid-cluster-partial',
  scrim: '--cid-scrim',
  surface: '--cid-ink-700',
  base: '--cid-ink-800',
  text: '--cid-text',
  value: '--cid-value',
} as const
