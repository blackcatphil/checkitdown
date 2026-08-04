#!/usr/bin/env node
/**
 * BUILDING GROUPS — a property is a GROUP of masses, not one polygon.
 *
 * ARIA genuinely is a podium with a tower on it; Caesars is five towers plus
 * Nobu; Mandalay Bay is three wings. Extruding each component at its own height
 * is what the building actually looks like — and it dissolves the divergence
 * that has now appeared three times (Overpass tallest-within-130m, the
 * hand-modelled massing, containment) rather than choosing a side:
 *
 *   - `isRoomBuilding` marks the CONTAINMENT match — which building the poker
 *     room is inside. That is what hover uses.
 *   - the GROUP supplies the skyline's mass.
 *
 * Group membership is a JUDGEMENT — it is what put Bellagio Self Parking Garage
 * on Bellagio — so it is hand-authored below and verifiable by eye, which is
 * what 17 properties makes tractable.
 *
 * HEIGHTS ARE CANDIDATE DATA: source_url and fetched_at set, verified_at NULL,
 * exactly like every other fact. An uncited height is NOT seeded — the property
 * renders flat, which is the flat-footprint rule working.
 *
 *   node scripts/room-groups.mjs   ->  lib/room-footprints.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FETCHED = '2026-08-04'
const W = 'https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Las_Vegas'
const WNV = 'https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Nevada'
const wiki = (page) => `https://en.wikipedia.org/wiki/${page}`
/**
 * A NAMED OSM polygon carrying a height tag IS a citable source: it has a
 * stable URL, a version history with timestamps, and — crucially — an
 * IDENTIFIABLE SUBJECT. That is more provenance than several facts already
 * seeded here.
 *
 * The qualifier does all the work. An UNNAMED polygon has no identifiable
 * subject: `way/316302064` identifies a shape, not a building, so a citation
 * attached to it certifies nothing.
 */
const osm = (id) => `https://www.openstreetmap.org/way/${id}`

/**
 * slug -> components. `osm` is the way id in scripts/.footprints/<slug>.json.
 * `height` is metres from a CITED source; omit it and the component renders
 * flat. `note` records anything a reader would otherwise have to rediscover.
 */
const GROUPS = {
  'wynn-encore': [
    { osm: 27910891, name: 'Encore', height: 192, src: W, note: '631 ft, 52 floors' },
    { osm: 205501268, name: 'Wynn', height: 187, src: W, note: '614 ft, 49 floors' },
  ],
  venetian: [
    { osm: 30618090, name: 'Venetian tower', height: 145, src: W, note: '475 ft, 36 floors' },
    /* Palazzo lies outside the 170 m radius fetched around the poker room, so it
       was queried separately rather than attached to a nearer wrong shape. OSM
       independently tags it 196 m, matching the citation. */
    { osm: 30424125, file: '_palazzo', name: 'Palazzo', height: 196, src: W, note: '642 ft, 50 floors' },
  ],
  aria: [
    /* WEAKEST IDENTIFICATION IN THE SET, and flagged as such. The polygon is
       UNNAMED, so it is identified by its own OSM height tag (183 m) matching
       the Wikipedia figure — corroboration by number, not by name. That is
       better than Red Rock, where nothing corroborates the choice at all, and
       weaker than Palazzo, where two sources agree about a NAMED building. */
    { osm: 134930092, name: 'ARIA tower', height: 183, src: wiki('Aria_Resort_%26_Casino'), identifiedBy: 'height-match on an unnamed polygon', note: '600 ft, 48 floors' },
    { osm: 52175576, name: 'ARIA podium', roomBuilding: true, note: 'the containment match: 20 m, and the reason ARIA read 20 m three times' },
  ],
  bellagio: [
    {
      osm: 25723909,
      name: 'Bellagio main tower',
      height: 156,
      src: W,
      roomBuilding: true,
      conflict: { value: 120, source: 'OSM height tag', note: 'likely roof height vs architectural height' },
      note: '511 ft, 36 floors. FIRST IN THE VERIFICATION QUEUE — two sources disagree and neither is discarded',
    },
  ],
  'mandalay-bay': [
    { osm: 27858550, name: 'Mandalay Bay main tower', height: 146, src: W, roomBuilding: true, note: '480 ft, 44 floors' },
    { osm: 118347176, name: 'Delano', height: 148, src: W, note: '485 ft, 45 floors. OSM names this polygon "W Las Vegas" — same tower, different brand era; the mismatch is recorded rather than silently equated' },
  ],
  'caesars-palace': [
    /* Where BOTH sources exist and disagree, both are recorded — the same
       treatment Bellagio gets. Applying it to Bellagio and not here was the
       inconsistency: OSM cannot be a source in one row and not in another. */
    { osm: 1176928048, name: 'Augustus Tower', height: 105, src: W, conflict: { value: 111, source: osm(1176928048), note: '26 floors either way' }, note: '345 ft, 26 floors' },
    { osm: 134949098, name: 'Julius Tower', height: 45, src: W, conflict: { value: 52, source: osm(134949098), note: 'Wikipedia gives floors (14); OSM gives metres' }, note: '14 floors, ~45 m' },
    { osm: 134949402, name: 'Nobu / Centurion', height: 45, src: W, conflict: { value: 40, source: osm(134949402), note: 'Wikipedia gives floors (14); OSM gives metres' }, note: '14 floors, ~45 m' },
    { osm: 115672893, name: 'Caesars Palace podium', roomBuilding: true },
    /* NAMED OSM polygons with height tags — citable under the rule above, so
       the property's tallest tower no longer sits flat beside a shorter one. */
    { osm: 134944648, name: 'Palace Tower', height: 133, src: osm(134944648), note: '30 floors. OSM-sourced; no Wikipedia figure cited this session' },
    { osm: 126267789, name: 'Octavius Tower', height: 107, src: osm(126267789), note: '23 floors. OSM-sourced' },
    { osm: 134949102, name: 'Forum Tower', height: 71, src: osm(134949102), note: '22 floors. OSM-sourced' },
  ],
  horseshoe: [
    { osm: 116867081, name: 'Horseshoe Resort Tower', height: 83, src: 'https://www.caesars.com/horseshoe-las-vegas', roomBuilding: true, note: '26 floors, ~83 m. The 112 m polygon nearby is Le Boulevard At Paris — a DIFFERENT property, and the neighbour that contaminated the earlier room table' },
  ],
  /* RED ROCK IS NOT SEEDED, and the reason matters: the ~60 m hotel-tower
     height IS cited, but no polygon in the cache is named, so choosing one
     means picking the largest unnamed shape and calling it the tower. That is
     the ARIA error in a new hat — a cited number attached to a guessed
     geometry. A cited height is not enough; the polygon has to be identified
     too. It renders flat until someone names it. */
  'south-point': [
    { osm: 472813789, name: 'South Point towers', height: 75, src: WNV, roomBuilding: true, note: '~245 ft. The property has three towers; OSM carries one polygon, so this is one mass standing for three' },
  ],
}

const feats = []
const report = []

for (const [slug, comps] of Object.entries(GROUPS)) {
  let seeded = 0
  for (const c of comps) {
    const f = `scripts/.footprints/${c.file ?? slug}.json`
    if (!existsSync(f)) { report.push([slug, `NO CACHE ${c.file ?? slug}`, 0, 0]); continue }
    const els = JSON.parse(readFileSync(f, 'utf8')).elements ?? []
    const el = els.find((e) => e.id === c.osm && e.geometry)
    if (!el) { report.push([slug, `MISSING POLYGON ${c.osm}`, 0, 0]); continue }
    const ring = el.geometry.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))])
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ring.push(ring[0])
    if (c.height) seeded++
    feats.push({
      type: 'Feature',
      id: feats.length + 1,
      properties: {
        slug,
        component: c.name,
        /* Only a CITED height is seeded. No height -> renders flat. */
        ...(c.height ? {
          height: c.height,
          height_source_url: c.src,
          height_fetched_at: FETCHED,
          height_verified_at: null,
        } : {}),
        ...(c.conflict ? { height_conflict: c.conflict } : {}),
        ...(c.identifiedBy ? { identified_by: c.identifiedBy } : {}),
        isRoomBuilding: Boolean(c.roomBuilding),
        note: c.note ?? null,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  }
  report.push([slug, 'ok', comps.length, seeded])
}

const extruded = feats.filter((f) => f.properties.height).length
writeFileSync('lib/room-footprints.ts',
  `/**
 * BUILDING GROUPS — generated by scripts/room-groups.mjs. Do not hand-edit.
 *
 * A property is a GROUP of masses. \`isRoomBuilding\` marks the containment
 * match (which building the poker room is inside — what hover uses); the group
 * supplies the skyline.
 *
 * Heights are CANDIDATE DATA: \`height_source_url\` and \`height_fetched_at\`
 * set, \`height_verified_at\` NULL. A component with no cited height carries no
 * \`height\` at all and renders FLAT — "there is a building here and we have not
 * sourced its height", which is true.
 *
 * ${extruded} of ${feats.length} components carry a cited height.
 *
 * PROVENANCE DEBT: this is still a checked-in file. These belong in the
 * database alongside every other sourced fact.
 */
export const ROOM_FOOTPRINTS = ${JSON.stringify({ type: 'FeatureCollection', features: feats })} as const
`)

console.log('property            components  seeded')
for (const [slug, status, n, s] of report) {
  console.log(`  ${slug.padEnd(20)} ${String(n).padStart(3)}  ${String(s).padStart(6)}  ${status === 'ok' ? '' : status}`)
}
console.log(`\n  ${feats.length} components across ${Object.keys(GROUPS).length} properties`)
console.log(`  ${extruded} carry a cited height and will EXTRUDE`)
console.log(`  ${feats.length - extruded} render FLAT — uncited, which is the rule working`)
