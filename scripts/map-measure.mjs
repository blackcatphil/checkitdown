#!/usr/bin/env node
/**
 * MAP MEASURE — re-measure the map's constants against MAPLIBRE, not Leaflet.
 *
 * This replaces map-fit.mjs and map-tilt.mjs, both of which measured a Leaflet
 * projection with a CSS tilt applied to a canvas overlay. MapLibre's camera is
 * genuinely 3D and its clustering is supercluster, which grids in Mercator
 * space by zoom rather than absorbing by screen proximity. **Every constant is
 * therefore a claim to re-verify, not a value to carry across** — the same rule
 * that caught the mock being wrong three times, applied to our own numbers.
 *
 * Uses the REAL supercluster, the same library MapLibre uses internally, so the
 * grouping here is the grouping the browser will produce.
 *
 *   node scripts/map-measure.mjs
 */
import { execFileSync } from 'node:child_process'

import Supercluster from 'supercluster'

const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const rows = execFileSync(PSQL, [DB, '-qtAX', '-F', '\t', '-c',
  `select slug, name, area, latitude, longitude from rooms
    where status <> 'closed' and status <> 'seasonal' and not is_seasonal
    order by name`], { encoding: 'utf8' })
  .trim().split('\n').map((l) => {
    const [slug, name, area, lat, lon] = l.split('\t')
    return { slug, name, area, lat: Number(lat), lon: Number(lon) }
  })

const points = rows.map((r) => ({
  type: 'Feature',
  properties: { slug: r.slug, name: r.name },
  geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
}))

/** Mercator pixel at a zoom — pitch does not affect supercluster, which grids
 *  in unpitched Mercator space. The tilted screen positions differ; the
 *  GROUPING does not. */
const world = (lat, lon, z) => {
  const size = 512 * 2 ** z // MapLibre uses 512px tiles, Leaflet used 256
  const s = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  }
}

const VW = 938
const VH = 760
const PIN = 32
const CLUSTER = 44

console.log(`${rows.length} rooms on the roster`)
console.log('NOTE: MapLibre tiles are 512px, Leaflet\'s were 256 — so a MapLibre')
console.log('zoom is one step "closer" in pixel terms. Carrying z11 across would')
console.log('have been wrong before anything else was considered.\n')

console.log('=== WHOLE VALLEY — every room visible, zero overlap between rendered pins ===')
console.log('radius | zoom | pins | rooms shown | fits 938x760 | tightest edge gap | overlaps')
for (const radius of [40, 50, 60]) {
  for (const z of [9, 9.5, 10, 10.5, 11]) {
    const idx = new Supercluster({ radius, maxZoom: 16, minZoom: 0 })
    idx.load(points)
    const cl = idx.getClusters([-180, -85, 180, 85], Math.round(z))
    const o = world(
      (Math.max(...rows.map((r) => r.lat)) + Math.min(...rows.map((r) => r.lat))) / 2,
      (Math.max(...rows.map((r) => r.lon)) + Math.min(...rows.map((r) => r.lon))) / 2, z)
    const pts = cl.map((c) => {
      const w = world(c.geometry.coordinates[1], c.geometry.coordinates[0], z)
      return { ...c, x: w.x - o.x + VW / 2, y: w.y - o.y + VH / 2 }
    })
    const shown = cl.reduce((s, c) => s + (c.properties.point_count ?? 1), 0)
    const fits = pts.filter((p) => p.x > 20 && p.x < VW - 20 && p.y > 20 && p.y < VH - 20).length
    let gap = Infinity
    let over = 0
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
        const need = ((pts[i].properties.point_count ? CLUSTER : PIN)
          + (pts[j].properties.point_count ? CLUSTER : PIN)) / 2
        if (d < need) over++
        gap = Math.min(gap, d - need)
      }
    }
    console.log(
      `${String(radius).padStart(6)} | ${String(z).padEnd(4)} | ${String(cl.length).padStart(4)} `
      + `| ${String(shown).padStart(11)} | ${String(fits).padStart(2)}/${cl.length}`.padEnd(15)
      + `| ${(gap === Infinity ? '-' : gap.toFixed(1)).padStart(8)}px       | ${over}`)
  }
  console.log('')
}

console.log('CAVEAT: the STRIP figures below use a FLAT viewport rectangle and so')
console.log('UNDERSTATE what is in frame — pitch extends the visible ground toward')
console.log('the horizon. The pitched figure is the spike\'s observed 8 of 17 at')
console.log('z14.5 / pitch 52, which was measured in a browser rather than computed.\n')

console.log('=== STRIP LANDING — how many rooms in frame, and does the Strip stay clustered? ===')
const strip = rows.filter((r) => r.area === 'strip')
const C = {
  lat: strip.reduce((a, r) => a + r.lat, 0) / strip.length,
  lon: strip.reduce((a, r) => a + r.lon, 0) / strip.length,
}
console.log(`Strip centre ${C.lat.toFixed(4)}, ${C.lon.toFixed(4)}`)
console.log('zoom | in frame | pins | clustered rooms | note')
for (const z of [12.5, 13, 13.5, 14, 14.5]) {
  const idx = new Supercluster({ radius: 50, maxZoom: 16, minZoom: 0 })
  idx.load(points)
  const o = world(C.lat, C.lon, z)
  const half = { x: VW / 2, y: VH / 2 }
  const toLngLat = (dx, dy) => {
    const size = 512 * 2 ** z
    const lon = ((o.x + dx) / size) * 360 - 180
    const n = Math.PI - (2 * Math.PI * (o.y + dy)) / size
    return [lon, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))]
  }
  const sw = toLngLat(-half.x, half.y)
  const ne = toLngLat(half.x, -half.y)
  const cl = idx.getClusters([sw[0], sw[1], ne[0], ne[1]], Math.round(z))
  const shown = cl.reduce((s, c) => s + (c.properties.point_count ?? 1), 0)
  const clustered = cl.filter((c) => c.properties.point_count).length
  console.log(
    `${String(z).padEnd(4)} | ${String(shown).padStart(8)} | ${String(cl.length).padStart(4)} `
    + `| ${String(clustered).padStart(15)} | ${clustered ? 'Strip still grouped' : 'all separate'}`)
}
