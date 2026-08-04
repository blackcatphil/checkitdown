#!/usr/bin/env node
/**
 * OSM BUILDING HEIGHT COVERAGE — does a vector-tile skyline actually exist?
 *
 * MapLibre's `building` source-layer extrudes from OSM `height` /
 * `building:levels`. A building with neither renders flat or at a default, so
 * the question "skyline or parking lot" is entirely a question of tag coverage.
 * This measures it before any migration is started.
 *
 * Two numbers matter:
 *   1. our 17 rooms — does each room's own building carry a height
 *   2. the surrounding Strip blocks — what proportion carry one
 *
 *   node scripts/osm-heights.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/* Partial results are cached so a rate-limited re-run resumes instead of
   re-asking a free public endpoint for what we already have. */
const CACHE = new URL('./.osm-heights-cache.json', import.meta.url).pathname
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  // overpass.osm.jp dropped: certificate expired as of 2026-08-04
]

const rooms = execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',
  ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-qtAX', '-F', '\t', '-c',
    `select slug, name, area, latitude, longitude from rooms
      where status <> 'closed' and not is_seasonal order by name`],
  { encoding: 'utf8' }).trim().split('\n').map((l) => {
    const [slug, name, area, lat, lon] = l.split('\t')
    return { slug, name, area, lat: Number(lat), lon: Number(lon) }
  })

async function overpass(q, endpoint) {
  /* Overpass returns 406 to a request with no User-Agent — isolated by testing
     with and without, after curl worked and fetch did not. */
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'User-Agent': 'checkitdown-research/0.1 (blackcatphil23@gmail.com)' },
    body: new URLSearchParams({ data: q }),
  })
  if (!res.ok) throw new Error(`overpass ${res.status}`)
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Overpass 504s on a 17-way union of `around` queries, so ask one at a time
 *  and back off rather than hammering a free public endpoint. */
async function overpassRetry(q, tries = 6) {
  let last
  for (let i = 0; i < tries; i++) {
    const ep = ENDPOINTS[i % ENDPOINTS.length]
    try { return await overpass(q, ep) } catch (e) {
      last = e
      await sleep(2500 * (i + 1))
    }
  }
  throw last
}

/** A tag counts only if it yields a real height, not merely if it exists. */
const heightOf = (t = {}) => {
  if (t.height) {
    const m = parseFloat(String(t.height).replace(/[^\d.]/g, ''))
    if (m > 0) return { m, from: 'height' }
  }
  if (t['building:levels']) {
    const lv = parseFloat(t['building:levels'])
    if (lv > 0) return { m: lv * 3.2, from: 'levels' }
  }
  return null
}

console.log('=== 1. OUR 17 ROOMS — does the room\'s own building carry a height? ===\n')
let withH = 0
for (const r of rooms) {
  if (!cache[r.slug]) {
    cache[r.slug] = await overpassRetry(
      `[out:json][timeout:40];way["building"](around:130,${r.lat},${r.lon});out tags center;`,
    )
    writeFileSync(CACHE, JSON.stringify(cache))
    await sleep(2000)
  }
  const res = cache[r.slug]
  // nearest building to the room centroid that carries a usable height
  const near = (res.elements ?? [])
    .filter((e) => e.center)
    .map((e) => ({
      e,
      d: Math.hypot((e.center.lat - r.lat) * 111000, (e.center.lon - r.lon) * 90000),
    }))
    .filter((x) => x.d < 200)
    .sort((a, b) => a.d - b.d)
  /* The TALLEST building within the radius, not the nearest: a resort's
     centroid usually sits over a low podium, and it is the tower that reads as
     the property on a skyline. Picking `nearest` gave ARIA 20m. */
  const withHeights = near.map((x) => ({ ...x, h: heightOf(x.e.tags) })).filter((x) => x.h)
  withHeights.sort((a, b) => b.h.m - a.h.m)
  const named = withHeights[0] ?? near[0]
  const h = named ? heightOf(named.e.tags) : null
  if (h) withH++
  console.log(
    `  ${r.name.padEnd(19)} ${near.length ? String(near.length).padStart(2) : ' 0'} bldg nearby  `
    + (h ? `HEIGHT ${h.m.toFixed(0).padStart(3)}m (${h.from})` : 'no height tag')
    + (named?.e.tags?.name ? `  [${named.e.tags.name}]` : ''),
  )
}
console.log(`\n  rooms whose building carries a usable height: ${withH}/${rooms.length}`)

console.log('\n=== 2. THE SURROUNDING STRIP — what proportion of blocks extrude? ===\n')
if (!cache.__strip) {
  cache.__strip = await overpassRetry(
    '[out:json][timeout:90];way["building"](36.0880,-115.1850,36.1350,-115.1550);out tags;',
  )
  writeFileSync(CACHE, JSON.stringify(cache))
}
const strip = cache.__strip
const all = strip.elements.filter((e) => e.tags)
const hs = all.map((e) => heightOf(e.tags))
const n = all.length
const withHeight = hs.filter(Boolean).length
const byHeight = hs.filter((h) => h?.from === 'height').length
const byLevels = hs.filter((h) => h?.from === 'levels').length
console.log(`  buildings in the Strip corridor: ${n}`)
console.log(`  with a usable height:            ${withHeight} (${((withHeight / n) * 100).toFixed(0)}%)`)
console.log(`    from height=                   ${byHeight}`)
console.log(`    from building:levels=          ${byLevels}`)
console.log(`  with NO height at all:           ${n - withHeight} (${(((n - withHeight) / n) * 100).toFixed(0)}%)`)

const tall = hs.filter(Boolean).map((h) => h.m).sort((a, b) => b - a)
console.log(`  tallest tagged: ${tall.slice(0, 8).map((m) => `${m.toFixed(0)}m`).join(', ')}`)
console.log(`  median tagged height: ${tall.length ? tall[Math.floor(tall.length / 2)].toFixed(0) : '-'}m`)
