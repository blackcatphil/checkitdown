import type L from 'leaflet'

import { LANDMARKS, type Mass, ROOM_MASSES } from '@/lib/massing'

/**
 * TIER B — extruded massing, painted on a canvas above the Leaflet pane.
 *
 * Tier A (pins + absorption clustering) stays underneath and is what runs
 * city-wide; this only engages when you zoom into the Strip. Nothing here
 * touches the pin layer's measured behaviour.
 *
 * Colour comes from readTokens(MAP_TOKENS) — the module this was ported from
 * still had the OLD FELT GREEN in its building gradients (rgb 84,100,89) while
 * the brief listed re-skinning as done, which is exactly the drift the token
 * path exists to stop.
 */

export const TILT = 60
export const PERSP = 820
/**
 * Below this the pin layer owns the view.
 *
 * Set to 14 because that is where the module's OWN fine-footprint threshold
 * (ppm >= 0.12) is met — not an aesthetic choice. At 13.5 ppm is 0.092 and the
 * original code compensated by INFLATING masses to a floor size so they stayed
 * visible. That is fabricating a fact about how big a building is, on the
 * surface where this product's honesty is most visible — the same class of
 * error as inventing a rake figure. The inflation path is gone entirely; above
 * this zoom every footprint is drawn at its modelled size.
 */
export const MIN_3D_ZOOM = 14
const FINE_PPM = 0.12

export type Palette = Record<string, string>

type Vol = {
  ground: Pt[]
  roof: Pt[]
  apex: Pt | null
  depth: number
  hpx: number
  kind: 'room' | 'out' | 'sel' | 'land'
}
type Pt = { x: number; y: number; z: number }

/**
 * A token may be a hex or an rgb()/rgba() string; both need an alpha applied.
 *
 * The two eslint-disable lines below are the ONLY suppressions of the
 * no-raw-colour rule in the codebase, and they are narrow on purpose: this
 * function is the token-to-rgba converter itself. Its input is always a value
 * read from colors.css via readTokens(); it emits `rgba(...)` because canvas
 * gradients demand a string. Nothing here is a colour someone chose — a wide
 * disable, or restructuring the string to dodge the matcher, would be evading
 * the rule rather than satisfying it.
 */
function withAlpha(colour: string, a: number): string {
  const c = colour.trim()
  if (c.startsWith('#')) {
    const h = c.slice(1)
    const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
    const n = parseInt(f.slice(0, 6), 16)
    // eslint-disable-next-line no-restricted-syntax -- token -> rgba conversion, not a chosen colour
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  const m = c.match(/-?[\d.]+/g)
  // eslint-disable-next-line no-restricted-syntax -- token -> rgba conversion, not a chosen colour
  if (m && m.length >= 3) return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})`
  return c
}

function pxPerMetre(map: L.Map) {
  const c = map.getCenter()
  const z = map.getZoom()
  const a = map.project(c, z)
  const b = map.project({ lat: c.lat, lng: c.lng + 0.01 } as L.LatLngLiteral, z)
  return Math.abs(b.x - a.x) / map.distance(c, { lat: c.lat, lng: c.lng + 0.01 } as L.LatLngLiteral)
}

/** Metre offsets -> lat/lng ring. Bearing rotates the plan; `round` gives a
 *  14-gon, which is enough at these pixel sizes. */
function ring(base: { lat: number; lon: number }, m: Mass) {
  const latM = 1 / 110540
  const lonM = 1 / (111320 * Math.cos((base.lat * Math.PI) / 180))
  const t = ((m.b || 0) * Math.PI) / 180
  const hw = m.w / 2
  const hd = m.d / 2
  const pts: Array<[number, number]> =
    m.shape === 'round'
      ? Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2
          return [Math.cos(a) * hw, Math.sin(a) * hd] as [number, number]
        })
      : [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
  return pts.map(([px, py]) => {
    const x = px * Math.cos(t) - py * Math.sin(t) + (m.x || 0)
    const y = px * Math.sin(t) + py * Math.cos(t) + (m.y || 0)
    return { lat: base.lat + y * latM, lng: base.lon + x * lonM }
  })
}

export function drawMassing(
  map: L.Map,
  canvas: HTMLCanvasElement,
  rooms: Array<{ slug: string; name: string; latitude: number; longitude: number }>,
  opts: { lit: Set<string>; selected: string | null; palette: Palette; enabled: boolean },
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = map.getSize()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = size.x * dpr
  canvas.height = size.y * dpr
  canvas.style.width = `${size.x}px`
  canvas.style.height = `${size.y}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.x, size.y)
  if (!opts.enabled) return

  const ppm = pxPerMetre(map)
  /* MIN_3D_ZOOM guarantees this; if it is ever lowered, drawing stops rather
     than silently resizing buildings to look better than the data supports. */
  if (ppm < FINE_PPM) return
  const T = (TILT * Math.PI) / 180
  const ox = size.x * 0.5
  const oy = size.y * 0.62
  const px0 = size.x * 0.5
  const py0 = size.y * 0.26

  const project = (ll: { lat: number; lng: number }, hpx: number): Pt => {
    const cp = map.latLngToContainerPoint(ll as L.LatLngLiteral)
    const vx = cp.x - ox
    const vy = cp.y - oy
    let y = vy * Math.cos(T)
    let z = vy * Math.sin(T)
    if (hpx) { y -= hpx * Math.sin(T); z += hpx * Math.cos(T) }
    const s = PERSP / Math.max(80, PERSP - z)
    return { x: px0 + (ox + vx - px0) * s, y: py0 + (oy + y - py0) * s, z }
  }

  const vols: Vol[] = []
  const push = (base: { lat: number; lon: number }, m: Mass, kind: Vol['kind']) => {
    const r0 = ring(base, m)
    const hpx = m.h * ppm
    const ground = r0.map((ll) => project(ll, 0))
    const cLat = r0.reduce((a, p) => a + p.lat, 0) / r0.length
    const cLon = r0.reduce((a, p) => a + p.lng, 0) / r0.length
    const capF = m.cap || 1
    const roofLL = capF === 1 ? r0 : r0.map((ll) => ({
      lat: cLat + (ll.lat - cLat) * capF,
      lng: cLon + (ll.lng - cLon) * capF,
    }))
    vols.push({
      ground,
      roof: roofLL.map((ll) => project(ll, hpx)),
      apex: m.shape === 'pyramid' ? project({ lat: cLat, lng: cLon }, hpx) : null,
      depth: ground.reduce((s, p) => s + p.z, 0) / ground.length,
      hpx,
      kind,
    })
  }

  for (const r of rooms) {
    const masses = ROOM_MASSES[r.slug]
    if (!masses) continue
    const kind: Vol['kind'] = r.slug === opts.selected ? 'sel' : opts.lit.has(r.slug) ? 'room' : 'out'
    for (const m of masses) push({ lat: r.latitude, lon: r.longitude }, m, kind)
  }
  for (const l of LANDMARKS) for (const m of l.masses) push({ lat: l.lat, lon: l.lon }, m, 'land')

  vols.sort((a, b) => a.depth - b.depth)

  const P = opts.palette
  const face = (kind: Vol['kind']) =>
    kind === 'sel' ? { base: P.accentDeep, top: P.clusterPartial, lo: 0.62, hi: 0.28 }
      : kind === 'out' ? { base: P.base, top: P.pinDim, lo: 0.4, hi: 0.14 }
      : kind === 'land' ? { base: P.base, top: P.surface, lo: 0.6, hi: 0.2 }
      : { base: P.base, top: P.pin, lo: 0.62, hi: 0.26 }

  for (const v of vols) {
    const g = v.ground
    const n = g.length
    ctx.beginPath()
    ctx.moveTo(g[0].x, g[0].y)
    for (let i = 1; i < n; i++) ctx.lineTo(g[i].x, g[i].y)
    ctx.closePath()
    ctx.fillStyle = withAlpha(P.scrim, 0.42)
    ctx.fill()

    if (v.hpx <= 0) continue
    const f = face(v.kind)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const t1 = v.apex || v.roof[i]
      const t2 = v.apex || v.roof[j]
      // back-face cull: only paint walls turned toward the camera
      if ((g[j].x - g[i].x) * (t1.y - g[i].y) - (g[j].y - g[i].y) * (t1.x - g[i].x) <= 0) continue
      const len = Math.max(1, Math.hypot(g[j].x - g[i].x, g[j].y - g[i].y))
      const lit = 0.5 + 0.5 * ((g[j].x - g[i].x) / len)
      ctx.beginPath()
      ctx.moveTo(g[i].x, g[i].y)
      ctx.lineTo(g[j].x, g[j].y)
      if (v.apex) ctx.lineTo(v.apex.x, v.apex.y)
      else { ctx.lineTo(t2.x, t2.y); ctx.lineTo(t1.x, t1.y) }
      ctx.closePath()
      const grad = ctx.createLinearGradient(g[i].x, g[i].y, t1.x, t1.y)
      grad.addColorStop(0, withAlpha(f.base, 0.99))
      grad.addColorStop(1, withAlpha(f.top, f.lo + f.hi * lit))
      ctx.fillStyle = grad
      ctx.fill()
    }

    if (!v.apex) {
      ctx.beginPath()
      ctx.moveTo(v.roof[0].x, v.roof[0].y)
      for (let i = 1; i < v.roof.length; i++) ctx.lineTo(v.roof[i].x, v.roof[i].y)
      ctx.closePath()
      ctx.fillStyle = withAlpha(f.top, v.kind === 'out' ? 0.34 : 0.72)
      ctx.fill()
      ctx.strokeStyle = withAlpha(f.top, v.kind === 'out' ? 0.2 : 0.5)
      ctx.lineWidth = 0.6
      ctx.stroke()
    }
  }
}
