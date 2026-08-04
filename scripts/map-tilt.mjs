#!/usr/bin/env node
/**
 * MAP TILT — what a 60° camera does to crowding, measured on REAL centroids.
 *
 * map-fit.mjs measured the FLAT layer and found the mock's "0 overlaps" false.
 * Tilt is the harder case: it compresses everything toward the horizon, so two
 * pins comfortably apart flat can collide once tilted. The massing offsets and
 * label culling were tuned against mock coordinates, so this re-measures them
 * against the real ones before any of it is trusted.
 *
 * Replicates the module's project(): container point -> tilt about a horizon
 * origin -> perspective divide. Same maths, no browser.
 *
 *   node scripts/map-tilt.mjs
 */
import { execFileSync } from 'node:child_process'

const PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const TILT = 60
const PERSP = 820
const VW = 938
const VH = 760
const PIN = 32

const rows = execFileSync(PSQL, [DB, '-qtAX', '-F', '\t', '-c',
  `select slug, name, area, latitude, longitude from rooms
    where status <> 'closed' and not is_seasonal order by name`],
  { encoding: 'utf8' }).trim().split('\n').map((l) => {
    const [slug, name, area, lat, lon] = l.split('\t')
    return { slug, name, area, lat: Number(lat), lon: Number(lon) }
  })

const world = (lat, lon, z) => {
  const size = 256 * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size,
  }
}

/** The module's projection, verbatim in shape: tilt about (0.5w, 0.62h), then
 *  perspective about (0.5w, 0.26h). hpx is height in pixels. */
const project = (cp, hpx, tilted) => {
  const ox = VW * 0.5
  const oy = VH * 0.62
  const vx = cp.x - ox
  const vy = cp.y - oy
  const T = (tilted ? TILT : 0) * Math.PI / 180
  let y = vy * Math.cos(T)
  let z = vy * Math.sin(T)
  if (hpx) { y -= hpx * Math.sin(T); z += hpx * Math.cos(T) }
  const qx = ox + vx
  const qy = oy + y
  const px = VW * 0.5
  const py = VH * 0.26
  const s = PERSP / Math.max(80, PERSP - z)
  return { x: px + (qx - px) * s, y: py + (qy - py) * s, z }
}

const pxPerMetre = (lat, z) => (256 * 2 ** z) / (40075016.686 * Math.cos((lat * Math.PI) / 180))

/* Centre on the Strip — 3D is the reward for zooming in, so measure it there. */
const strip = rows.filter((r) => r.area === 'strip')
const centre = {
  lat: strip.reduce((a, r) => a + r.lat, 0) / strip.length,
  lon: strip.reduce((a, r) => a + r.lon, 0) / strip.length,
}
console.log(`Strip centre ${centre.lat.toFixed(4)}, ${centre.lon.toFixed(4)} — ${strip.length} rooms`)
console.log(`viewport ${VW}x${VH}, tilt ${TILT}°, perspective ${PERSP}\n`)

console.log('zoom | px/m   | in view | FLAT closest | TILTED closest | tilt penalty | collisions')
for (const z of [13, 13.5, 14, 14.5, 15, 16]) {
  const o = world(centre.lat, centre.lon, z)
  const cps = rows.map((r) => {
    const w = world(r.lat, r.lon, z)
    return { ...r, cp: { x: w.x - o.x + VW / 2, y: w.y - o.y + VH / 2 } }
  })
  const inView = cps.filter((c) => c.cp.x > -200 && c.cp.x < VW + 200 && c.cp.y > -200 && c.cp.y < VH + 200)

  const flat = inView.map((c) => ({ ...c, p: project(c.cp, 0, false) }))
  const tilt = inView.map((c) => ({ ...c, p: project(c.cp, 0, true) }))
  const closest = (arr) => {
    let m = Infinity
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++)
        m = Math.min(m, Math.hypot(arr[i].p.x - arr[j].p.x, arr[i].p.y - arr[j].p.y))
    return m
  }
  const collisions = (arr) => {
    let n = 0
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++)
        if (Math.hypot(arr[i].p.x - arr[j].p.x, arr[i].p.y - arr[j].p.y) < PIN) n++
    return n
  }
  const f = closest(flat)
  const t = closest(tilt)
  console.log(
    `${String(z).padEnd(4)} | ${pxPerMetre(centre.lat, z).toFixed(3)}  | ${String(inView.length).padStart(2)}/${rows.length}   `
    + `| ${(f === Infinity ? '-' : f.toFixed(1)).padStart(7)}px    | ${(t === Infinity ? '-' : t.toFixed(1)).padStart(7)}px      `
    + `| ${f && t ? `${((1 - t / f) * 100).toFixed(0)}%`.padStart(5) : '   - '}        | flat ${collisions(flat)} / tilt ${collisions(tilt)}`,
  )
}

/* The 3D threshold the module uses: coarse below ppm 0.12, i.e. a real
   footprint is only a few pixels wide, so masses are inflated to stay visible. */
console.log('\n3D activation threshold (module: ppm >= 0.12):')
for (const z of [12.5, 13, 13.5, 14]) {
  const ppm = pxPerMetre(centre.lat, z)
  console.log(`  z${z}  ppm ${ppm.toFixed(3)}  -> ${ppm >= 0.12 ? 'FINE (real footprints)' : 'coarse (masses inflated)'}`)
}

/* A 150 m tower at 60° tilt leans this far up the screen — the number that
   decides whether massing occludes the pins it is meant to sit under. */
console.log('\nlean of a tower, in screen px (height * ppm * cos(tilt)):')
for (const z of [13.5, 14, 15]) {
  const ppm = pxPerMetre(centre.lat, z)
  for (const h of [92, 155, 186]) {
    console.log(`  z${z}  ${h}m -> ${(h * ppm * Math.cos((TILT * Math.PI) / 180)).toFixed(0)}px up, base shifts ${(h * ppm * Math.sin((TILT * Math.PI) / 180)).toFixed(0)}px in depth`)
  }
}

/* =====================================================================
   LANDING-ZOOM EVIDENCE. The Strip is now the front door, so the pin
   layer has to be re-measured AT THE LANDING ZOOM under tilt — its z11
   numbers say nothing about z14+. Absorption is 40px (cluster 44 +
   single 32, halved and summed = 38, plus a gap).
   ===================================================================== */
const ABSORB = 40
const SINGLE = 32
const CLUSTER = 44
const stripC = { lat: centre.lat, lon: centre.lon }

console.log('\n=== LANDING ZOOM CANDIDATES (Strip centre, tilted) ===')
console.log('zoom  | lean 155m | in view | pins | closest pair | overlaps | pin-vs-building offset')
for (const z of [14, 14.5, 15]) {
  const ppm = pxPerMetre(stripC.lat, z)
  const o = world(stripC.lat, stripC.lon, z)
  const cps = rows.map((r) => {
    const w = world(r.lat, r.lon, z)
    return { ...r, cp: { x: w.x - o.x + VW / 2, y: w.y - o.y + VH / 2 } }
  })
  const inView = cps.filter((c) => c.cp.x > -60 && c.cp.x < VW + 60 && c.cp.y > -60 && c.cp.y < VH + 60)

  /* Absorption must run in the space the pins are actually DRAWN in. */
  const tp = inView.map((c) => ({ ...c, p: project(c.cp, 0, true) }))
  const placed = []
  for (const p of tp) {
    const host = placed.find((q) => Math.hypot(q.p.x - p.p.x, q.p.y - p.p.y) < ABSORB)
    if (host) host.members.push(p.name)
    else placed.push({ ...p, members: [p.name] })
  }
  let closest = Infinity
  let over = 0
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const d = Math.hypot(placed[i].p.x - placed[j].p.x, placed[i].p.y - placed[j].p.y)
      const need = (placed[i].members.length > 1 ? CLUSTER : SINGLE) / 2
        + (placed[j].members.length > 1 ? CLUSTER : SINGLE) / 2
      if (d < need) over++
      closest = Math.min(closest, d)
    }
  }

  /* THE THING TO CHECK: Leaflet places markers UNTILTED; the canvas massing is
     tilted. If a room's pin and its own building land far apart, the landing
     view is visibly wrong. */
  const offsets = inView.map((c) => {
    const flat = project(c.cp, 0, false)
    const tilted = project(c.cp, 0, true)
    return Math.hypot(flat.x - tilted.x, flat.y - tilted.y)
  })
  const maxOff = Math.max(...offsets)
  const medOff = offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)]

  console.log(
    `z${String(z).padEnd(4)} | ${(155 * ppm * Math.cos((TILT * Math.PI) / 180)).toFixed(0).padStart(6)}px  `
    + `| ${String(inView.length).padStart(2)}/${rows.length}   | ${String(placed.length).padStart(3)}  `
    + `| ${closest === Infinity ? '   -  ' : closest.toFixed(1).padStart(6)}px    | ${String(over).padStart(2)}       `
    + `| median ${medOff.toFixed(0)}px, max ${maxOff.toFixed(0)}px`,
  )
}
