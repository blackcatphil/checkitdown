#!/usr/bin/env node
/**
 * ROOM FOOTPRINTS — fetch the 17 rooms' own building polygons once, pick the
 * right one deliberately, and emit GeoJSON we own.
 *
 * Why not highlight the vector-tile feature directly: that inherits three
 * fragilities, each of which has already bitten something here.
 *   1. it needs stable feature ids, which we have not confirmed
 *   2. it inherits the podium ambiguity — hover the tower, nothing lights,
 *      because the resolved feature was the podium
 *   3. vector tile feature ids are PER-TILE, so a resort spanning a tile
 *      boundary is two features and highlights in half
 *
 * Owning 17 polygons removes all three. It is the same principle as the rest of
 * the product: own the data rather than depend on someone else's rendering of
 * it. And it reopens selected-room-lights-its-own-mass, which the tiles' missing
 * `name` property appeared to have closed.
 *
 * THE MATCH METHOD IS RECORDED PER ROOM, because "matched by name" and "fell
 * back to geometry" are different claims and must not be collapsed.
 *
 *   node scripts/room-footprints.mjs   ->  spike/room-footprints.geojson
 *
 * NOTE: for the spike a fetched file is fine. These footprints eventually belong
 * in the database with provenance like every other fact — source, fetched_at,
 * verified_at — not hardcoded.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const UA = 'checkitdown-research/0.1 (blackcatphil23@gmail.com)'
const CACHE = 'scripts/.footprints'
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true })

const rooms = execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',
  ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-qtAX', '-F', '\t', '-c',
    `select slug, name, latitude, longitude from rooms
      where status <> 'closed' and not is_seasonal order by name`],
  { encoding: 'utf8' }).trim().split('\n').map((l) => {
    const [slug, name, lat, lon] = l.split('\t')
    return { slug, name, lat: Number(lat), lon: Number(lon) }
  })

/** Words that identify nothing — every resort on the Strip is a "Las Vegas
 *  hotel casino resort", so matching on them matches everything. */
const STOP = new Set(['las', 'vegas', 'hotel', 'casino', 'resort', 'the', 'at',
  'and', 'spa', 'tower', 'towers', 'north', 'south', 'east', 'west', 'station'])
const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w))

function nameMatches(roomName, bldgName) {
  if (!bldgName) return false
  const a = tokens(roomName)
  const b = tokens(bldgName)
  if (!a.length || !b.length) return false
  return a.some((x) => b.includes(x))
}

/** Ray casting. Containment is a real relation between a point and a polygon —
 *  unlike "nearest", which is a relation between a point and a guess. */
function contains(ring, lon, lat) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const areaOf = (ring) => {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1])
  }
  return Math.abs(a / 2)
}

function fetchRoom(r) {
  const f = `${CACHE}/${r.slug}.json`
  if (existsSync(f) && readFileSync(f, 'utf8').startsWith('{')) return JSON.parse(readFileSync(f, 'utf8'))
  const q = `[out:json][timeout:60];(way["building"](around:170,${r.lat},${r.lon});`
    + `relation["building"](around:170,${r.lat},${r.lon}););out tags geom;`
  for (let i = 0; i < 4; i++) {
    try {
      const out = execFileSync('curl', ['-s', '-m', '90', '-X', 'POST',
        'https://overpass-api.de/api/interpreter', '-A', UA,
        '--data-urlencode', `data=${q}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (out.startsWith('{')) { writeFileSync(f, out); return JSON.parse(out) }
    } catch { /* retry */ }
    execFileSync('sleep', [String(3 * (i + 1))])
  }
  return null
}

const features = []
const report = []

for (const r of rooms) {
  const data = fetchRoom(r)
  /* A failed fetch is NOT "no buildings here". Reporting them the same way is
     the unknown-vs-absent confusion, and it turned up in this very script:
     Caesars Palace read "0 candidates" when in fact Overpass never answered. */
  if (!data) {
    report.push([r.name, 'FETCH FAILED', null, 0])
    console.log(`  ${r.name.padEnd(19)} FETCH FAILED       — Overpass did not answer; not an absence`)
    continue
  }
  const polys = []
  for (const el of data?.elements ?? []) {
    let ring = null
    if (el.type === 'way' && el.geometry) ring = el.geometry.map((p) => [p.lon, p.lat])
    else if (el.type === 'relation' && el.members) {
      const outer = el.members.filter((m) => m.role === 'outer' && m.geometry)
      if (outer.length) ring = outer[0].geometry.map((p) => [p.lon, p.lat])
    }
    if (!ring || ring.length < 4) continue
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push(ring[0])
    polys.push({ ring, tags: el.tags ?? {}, area: areaOf(ring) })
  }

  /* Deliberate pick, ordered by how strong the claim is.
     CONTAINMENT OUTRANKS NAME, learned the hard way: "largest polygon whose name
     matches" chose Bellagio Self Parking Garage, Mandalay Bay Convention Center
     and Venetian Expo — all genuinely named after the property, all bigger than
     the hotel, none of them the building the poker room is in. A name says
     "related to"; containment says "the room is inside this". Same class as
     tallest-picks-the-neighbour. */
  let chosen = null
  let method = 'none'
  const holding = polys.filter((p) => contains(p.ring, r.lon, r.lat))
  const holdingNamed = holding.filter((p) => nameMatches(r.name, p.tags.name))
  const named = polys.filter((p) => nameMatches(r.name, p.tags.name))
  if (holdingNamed.length) {
    chosen = holdingNamed.sort((a, b) => b.area - a.area)[0]
    method = 'contains+name'
  } else if (holding.length) {
    chosen = holding.sort((a, b) => b.area - a.area)[0]
    method = 'contains'
  } else if (named.length) {
    chosen = named.sort((a, b) => b.area - a.area)[0]
    method = 'name-only'
  } else {
    if (polys.length) {
      chosen = polys.sort((a, b) => {
        const c = (p) => p.ring.reduce((s, q) => [s[0] + q[0] / p.ring.length, s[1] + q[1] / p.ring.length], [0, 0])
        const da = Math.hypot(...c(a).map((v, i) => v - [r.lon, r.lat][i]))
        const db = Math.hypot(...c(b).map((v, i) => v - [r.lon, r.lat][i]))
        return da - db
      })[0]
      method = 'nearest'
    }
  }

  if (chosen) {
    features.push({
      type: 'Feature',
      id: features.length + 1,
      properties: {
        slug: r.slug, room: r.name,
        matched: chosen.tags.name ?? null,
        method,
        height: chosen.tags.height ? parseFloat(String(chosen.tags.height).replace(/[^\d.]/g, '')) : null,
        levels: chosen.tags['building:levels'] ? parseFloat(chosen.tags['building:levels']) : null,
      },
      geometry: { type: 'Polygon', coordinates: [chosen.ring] },
    })
  }
  report.push([r.name, method, chosen?.tags.name ?? null, polys.length])
  console.log(`  ${r.name.padEnd(19)} ${method.padEnd(18)} ${chosen?.tags.name ?? '(unnamed polygon)'}  [${polys.length} candidates]`)
}

writeFileSync('spike/room-footprints.geojson',
  JSON.stringify({ type: 'FeatureCollection', features }, null, 1))

const by = (m) => report.filter((x) => x[1] === m).length
console.log(`\n  ${features.length}/${rooms.length} rooms matched to a polygon`)
console.log(`    contains + name:  ${by('contains+name')}   <- strongest: room is inside a building named for the property`)
console.log(`    contains:         ${by('contains')}`)
console.log(`    name only:        ${by('name-only')}   <- related, but the room is NOT inside it`)
console.log(`    nearest:          ${by('nearest')}   <- a guess, flagged as one`)
console.log(`    unmatched:        ${by('none')}`)
console.log(`    fetch failed:     ${by('FETCH FAILED')}   <- absence of data, not absence of buildings`)
