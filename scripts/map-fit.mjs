#!/usr/bin/env node
/**
 * MAP FIT — re-measure the landing map's invariants against REAL coordinates.
 *
 * The mock's numbers (z11 · 0 rooms outside the crop · 8 pins standing for all
 * 17 · 0 overlaps) were tuned against mock coordinates. Real lat/lon are OSM
 * property centroids on a genuinely crowded Strip, so those numbers are claims
 * to re-verify, not guarantees to preserve. Every previous mock-to-real move
 * found the mock wrong; this measures rather than assumes.
 *
 * Pure Web Mercator, the same projection Leaflet uses, so the pixel geometry
 * here is what the browser will produce — no headless browser required.
 *
 *   node scripts/map-fit.mjs
 */
import { execFileSync } from 'node:child_process'

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** Roster only — closed and seasonal rooms never get a pin. Mirrors inRoster(). */
const rows = execFileSync(
  PSQL,
  [DB, '-qtAX', '-F', '\t', '-c',
   `select slug, name, area, latitude, longitude
      from rooms
     where status <> 'closed' and status <> 'seasonal' and not is_seasonal
     order by name`],
  { encoding: 'utf8' },
).trim().split('\n').map((l) => {
  const [slug, name, area, lat, lon] = l.split('\t')
  return { slug, name, area, lat: Number(lat), lon: Number(lon) }
})

const project = (lat, lon, z) => {
  const size = 256 * 2 ** z
  const x = ((lon + 180) / 360) * size
  const s = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size
  return { x, y }
}

const lats = rows.map((r) => r.lat)
const lons = rows.map((r) => r.lon)
const bbox = {
  n: Math.max(...lats), s: Math.min(...lats),
  e: Math.max(...lons), w: Math.min(...lons),
}
const centre = { lat: (bbox.n + bbox.s) / 2, lon: (bbox.e + bbox.w) / 2 }

console.log(`rooms on the roster: ${rows.length}`)
console.log(`bbox  lat ${bbox.s.toFixed(4)} .. ${bbox.n.toFixed(4)}  (${((bbox.n - bbox.s) * 111).toFixed(1)} km tall)`)
console.log(`      lon ${bbox.w.toFixed(4)} .. ${bbox.e.toFixed(4)}  (${((bbox.e - bbox.w) * 111 * Math.cos((centre.lat * Math.PI) / 180)).toFixed(1)} km wide)`)
console.log(`centre ${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)}`)

/** Pin footprint: the design's pin is 32px, so two pins collide inside 32px. */
const PIN = 32

console.log('\nzoom | fits 938x760 | closest pair | overlapping pairs | clusters@32px | biggest')
for (const z of [10, 10.5, 11, 11.5, 11.6, 12, 12.5, 13]) {
  const pts = rows.map((r) => ({ ...r, ...project(r.lat, r.lon, z) }))
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
  const fits = pts.filter((p) => Math.abs(p.x - cx) < 938 / 2 - 40 && Math.abs(p.y - cy) < 760 / 2 - 40).length

  let closest = Infinity
  let overlaps = 0
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
      if (d < closest) closest = d
      if (d < PIN) overlaps++
    }
  }

  // Same absorption the module uses: a pin inside PIN px of a placed pin joins it.
  const placed = []
  for (const p of pts) {
    const host = placed.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < PIN)
    if (host) host.members.push(p.slug)
    else placed.push({ ...p, members: [p.slug] })
  }
  const biggest = Math.max(...placed.map((p) => p.members.length))
  console.log(
    `${String(z).padEnd(4)} | ${String(fits).padStart(2)}/${rows.length}        `
    + `| ${closest.toFixed(1).padStart(6)}px    | ${String(overlaps).padStart(2)}                `
    + `| ${String(placed.length).padStart(2)}            | ${biggest}`,
  )
}

console.log('\nclosest pairs at z12 (the ones that will fight):')
const p12 = rows.map((r) => ({ ...r, ...project(r.lat, r.lon, 12) }))
const pairs = []
for (let i = 0; i < p12.length; i++) {
  for (let j = i + 1; j < p12.length; j++) {
    pairs.push({ a: p12[i].name, b: p12[j].name, d: Math.hypot(p12[i].x - p12[j].x, p12[i].y - p12[j].y) })
  }
}
pairs.sort((a, b) => a.d - b.d).slice(0, 6)
  .forEach((p) => console.log(`  ${p.d.toFixed(1).padStart(6)}px  ${p.a} / ${p.b}`))

console.log('\nby area:')
for (const a of ['strip', 'downtown', 'off_strip', 'locals']) {
  const n = rows.filter((r) => r.area === a).length
  console.log(`  ${a.padEnd(10)} ${n}`)
}

/* ---- HOME VIEW, chosen from the numbers above rather than inherited ---- */
const HOME_Z = 11
const HOME = { lat: centre.lat, lon: centre.lon }
const hp = rows.map((r) => ({ ...r, ...project(r.lat, r.lon, HOME_Z) }))
const placed = []
for (const p of hp) {
  const host = placed.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < PIN)
  if (host) host.members.push(p.name)
  else placed.push({ ...p, members: [p.name] })
}
console.log(`\nHOME VIEW  centre ${HOME.lat.toFixed(4)}, ${HOME.lon.toFixed(4)}  z${HOME_Z}`)
console.log(`  rendered pins: ${placed.length}  (singles ${placed.filter((p) => p.members.length === 1).length}, clusters ${placed.filter((p) => p.members.length > 1).length})`)
console.log(`  rooms represented: ${placed.reduce((a, p) => a + p.members.length, 0)}/${rows.length}`)
let worst = Infinity
for (let i = 0; i < placed.length; i++)
  for (let j = i + 1; j < placed.length; j++)
    worst = Math.min(worst, Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y))
console.log(`  closest RENDERED pair: ${worst.toFixed(1)}px (>= ${PIN} means zero overlap)`)
placed.filter((p) => p.members.length > 1).sort((a, b) => b.members.length - a.members.length)
  .forEach((p) => console.log(`  cluster of ${p.members.length}: ${p.members.join(', ')}`))
