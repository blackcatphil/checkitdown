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
  /* ---------------------------------------------------------------------
     THE OTHER NINE, PROMOTED AS FLAT MASSES.
     ---------------------------------------------------------------------
     This set was curated around researched HEIGHTS, which left nine rooms with
     no mass at all — and once the filter dim moved onto the building, a room
     with no building had nothing to dim. They are promoted with NO HEIGHT:
     flat is the honest render for a building nobody has sourced a height for,
     and for the locals rooms it is also the accurate one. Nothing is
     synthesised from `building:levels` — that is the inflation path, and it is
     how MGM Grand became a two-storey box.
     Each way id was resolved by matching the already-vetted spike polygon
     against the OSM cache: centroid delta 0.0 and area ratio 1.0000 for all
     nine, so these identify the SAME polygon rather than re-running a match
     that has picked the wrong building three times.
     --------------------------------------------------------------------- */
  'boulder-station': [
    { osm: 88930441, name: 'Boulder Station', roomBuilding: true, note: 'named OSM polygon' },
  ],
  'golden-nugget': [
    { osm: 206151446, name: 'Golden Nugget Las Vegas', roomBuilding: true, note: 'named OSM polygon' },
  ],
  'green-valley-ranch': [
    { osm: 341326765, name: 'Green Valley Ranch Resort Spa & Casino', roomBuilding: true, note: 'named OSM polygon' },
  ],
  'mgm-grand': [
    { osm: 116770006, name: 'Hotel MGM Grand Las Vegas', roomBuilding: true,
      height: 89, src: wiki('MGM_Grand_Las_Vegas'), hfetched: '2026-08-07',
      note: 'named OSM polygon. levels=2 in OSM and DELIBERATELY UNUSED — that tag is what made MGM Grand a two-storey box. Height seeded 2026-08-07: 293 ft / 89 m / 30 floors per the Wikipedia property page, corroborated by CTBUH Skyscraper Center at 89.3 m — two sources agreeing about a NAMED building (the Palazzo case), and NOT recorded as a conflict: both state the same 293 ft, the metres differ only in rounding. One polygon stands for the whole main building including the 14-storey ex-Marina wing; the three 38-storey Signature condo-hotel towers are separate buildings east of the property and deliberately OUT of the group' },
  ],
  'santa-fe-station': [
    { osm: 961460045, name: 'Santa Fe Station Hotel and Casino', roomBuilding: true, note: 'named OSM polygon' },
  ],
  skyline: [
    { osm: 1019620432, name: 'Skyline Hotel and Casino', roomBuilding: true, note: 'named OSM polygon' },
  ],
  westgate: [
    { osm: 134691921, name: 'Westgate Las Vegas Resort & Casino', roomBuilding: true, note: 'named OSM polygon' },
  ],
  /* UNNAMED polygons, identified by CONTAINMENT — the room's coordinates fall
     inside them. Weaker than a name match and recorded as such, the same way
     ARIA's tower is. No height is claimed for either, so there is no cited
     number resting on a guessed shape. */
  orleans: [
    { osm: 532572299, name: 'The Orleans', roomBuilding: true,
      identifiedBy: 'containment on an unnamed polygon', note: 'the room falls inside it; OSM carries no name' },
  ],
  'red-rock': [
    { osm: 316302063, name: 'Red Rock Resort', roomBuilding: true,
      identifiedBy: 'containment on an unnamed polygon', note: 'the ~60 m tower height stays UNSEEDED — cited height, unidentified tower' },
  ],

  /* RED ROCK'S HEIGHT IS STILL NOT SEEDED, and the reason matters: the ~60 m hotel-tower
     height IS cited, but no polygon in the cache is named, so choosing one
     means picking the largest unnamed shape and calling it the tower. That is
     the ARIA error in a new hat — a cited number attached to a guessed
     geometry. A cited height is not enough; the polygon has to be identified
     too. It renders flat until someone names it. */
  'south-point': [
    { osm: 472813789, name: 'South Point towers', height: 75, src: WNV, roomBuilding: true, note: '~245 ft. The property has three towers; OSM carries one polygon, so this is one mass standing for three' },
  ],
}

/**
 * OUTWARD OFFSET, in metres, for the gold silhouette shell.
 *
 * fill-extrusion has no stroke, so "outline the whole volume" is built as a
 * DONUT: outer ring buffered outward, inner ring the original footprint. The
 * hole is what makes it an outline rather than a gold building — extruded, its
 * roof is a ring around the real roof and its walls are a rim around the mass.
 *
 * Miter offset along each vertex's angle bisector, computed in local metres so
 * a degree of longitude at latitude 36 is not treated as a degree of latitude.
 * The winding of an arbitrary OSM ring is not assumed: the offset is applied,
 * the area is compared, and the direction is FLIPPED if the polygon came out
 * smaller. A shell that shrank would sit inside the mass and be invisible —
 * exactly the kind of silent nothing this project keeps shipping.
 */
function bufferRing(ring, metres, { shrink = false } = {}) {
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length
  const mPerLat = 111320
  const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const lon0 = ring.reduce((a, p) => a + p[0], 0) / ring.length
  const pts = ring.slice(0, -1).map(([lon, lat]) => [(lon - lon0) * mPerLon, (lat - lat0) * mPerLat])
  const area = (ps) => {
    let a = 0
    for (let i = 0; i < ps.length; i++) {
      const [x1, y1] = ps[i]
      const [x2, y2] = ps[(i + 1) % ps.length]
      a += x1 * y2 - x2 * y1
    }
    return a / 2
  }
  const build = (d) => pts.map((v, i) => {
    const p = pts[(i - 1 + pts.length) % pts.length]
    const n = pts[(i + 1) % pts.length]
    const norm = ([x, y]) => { const L = Math.hypot(x, y) || 1; return [x / L, y / L] }
    const e1 = norm([v[0] - p[0], v[1] - p[1]])
    const e2 = norm([n[0] - v[0], n[1] - v[1]])
    const n1 = [e1[1], -e1[0]]
    const n2 = [e2[1], -e2[0]]
    const b = norm([n1[0] + n2[0], n1[1] + n2[1]])
    const cos = b[0] * n1[0] + b[1] * n1[1]
    const len = Math.min(d / (Math.abs(cos) < 0.25 ? 0.25 : Math.abs(cos)), d * 4)
    return [v[0] + b[0] * len, v[1] + b[1] * len]
  })
  /* The ring's winding is unknown, so BOTH directions are built and the one
     that moved the area the intended way is kept. Growing and shrinking need
     opposite choices, and picking wrong is silent: a shell that shrank hides
     inside the mass, a roof ring that grew swallows the roof it was meant to
     outline. */
  const a0 = Math.abs(area(pts))
  const cands = [build(metres), build(-metres)]
  const areas = cands.map((c) => Math.abs(area(c)))
  let out
  if (shrink) {
    const i = areas[0] < areas[1] ? 0 : 1
    /* A band wider than the building inverts the polygon. Below a fifth of the
       original area the ring is a knot rather than an outline, so it is dropped
       and reported rather than drawn wrong. */
    if (areas[i] < a0 * 0.2 || areas[i] >= a0) return null
    out = cands[i]
  } else {
    const i = areas[0] > areas[1] ? 0 : 1
    if (areas[i] <= a0) return null
    out = cands[i]
  }
  const back = out.map(([x, y]) => [
    Number((x / mPerLon + lon0).toFixed(6)),
    Number((y / mPerLat + lat0).toFixed(6)),
  ])
  back.push(back[0])
  return back
}

const feats = []
const shells = []
const roofs = []
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
        /* THE GEOMETRY IS A FACT AND CARRIES ITS OWN RECEIPT. Previously only
           the HEIGHT had provenance and the polygon had none, which made every
           footprint hardcoded geometry — a thing this project already ruled is
           not fine for production. Same shape as every other fact: a source, a
           date, and verified_at NULL until someone stands there. */
        source_url: osm(c.osm),
        fetched_at: FETCHED,
        verified_at: null,
        /* Only a CITED height is seeded. No height -> renders flat.
           A height researched AFTER the footprint pass carries its own fetch
           date via `hfetched` — the date rule: the stamp belongs to the day
           the fact was fetched, not the day the file was first derived. */
        ...(c.height ? {
          height: c.height,
          height_source_url: c.src,
          height_fetched_at: c.hfetched ?? FETCHED,
          height_verified_at: null,
        } : {}),
        ...(c.conflict ? { height_conflict: c.conflict } : {}),
        ...(c.identifiedBy ? { identified_by: c.identifiedBy } : {}),
        isRoomBuilding: Boolean(c.roomBuilding),
        note: c.note ?? null,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })

    /* Only a mass that is EXTRUDED gets a shell. A flat component has no volume
       to outline, and a gold ring lying on the ground would read as a claim
       that we know its height. */
    if (c.height) {
      /* THE ROOF RING — a donut whose OUTER edge is the real footprint and whose
         inner edge is the footprint pulled 3 m in. Extruded over the top of the
         mass it gives a hollow roof: the top reads as an outline instead of the
         gold slab a solid cap produced. */
      /* Narrow towers cannot take a 3 m inset without the ring closing on
         itself, so the band THINS before it gives up — Forum Tower needs 1.5 m.
         Dropping it instead would have left one mass with a filled gold roof
         beside fifteen outlined ones, which looks like a rendering bug. */
      const inner = [3, 1.5, 0.8].reduce((acc, d) => acc ?? bufferRing(ring, d, { shrink: true }), null)
      if (inner) {
        roofs.push({
          type: 'Feature',
          id: roofs.length + 1,
          properties: { slug, component: c.name, height: c.height },
          geometry: { type: 'Polygon', coordinates: [ring, [...inner].reverse()] },
        })
      } else {
        report.push([slug, `ROOF RING TOO THIN ${c.name}`, 0, 0])
      }

      const outer = bufferRing(ring, 2)
      if (outer) {
        shells.push({
          type: 'Feature',
          id: shells.length + 1,
          properties: { slug, component: c.name, height: c.height },
          geometry: { type: 'Polygon', coordinates: [outer, [...ring].reverse()] },
        })
      } else {
        report.push([slug, `SHELL FAILED ${c.name}`, 0, 0])
      }
    }
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

/**
 * SILHOUETTE SHELLS — each extruded mass buffered 2 m outward, as a DONUT
 * (outer = buffered, inner = the footprint). Extruded, it is a gold rim around
 * the whole volume rather than a gold building: the hole is the outline.
 *
 * ${shells.length} shells for ${extruded} extruded components.
 */
export const ROOM_SHELLS = ${JSON.stringify({ type: 'FeatureCollection', features: shells })} as const

/**
 * ROOF RINGS — outer ring is the real footprint, inner ring is it pulled 3 m in.
 * Extruded over the top few metres of each mass, the top face is a RING, so the
 * roof reads as an outline rather than as the gold slab a solid cap gave.
 *
 * ${roofs.length} rings for ${extruded} extruded components.
 */
export const ROOM_ROOFS = ${JSON.stringify({ type: 'FeatureCollection', features: roofs })} as const
`)

console.log('property            components  seeded')
for (const [slug, status, n, s] of report) {
  console.log(`  ${slug.padEnd(20)} ${String(n).padStart(3)}  ${String(s).padStart(6)}  ${status === 'ok' ? '' : status}`)
}
console.log(`\n  ${feats.length} components across ${Object.keys(GROUPS).length} properties`)
console.log(`  ${extruded} carry a cited height and will EXTRUDE`)
console.log(`  ${feats.length - extruded} render FLAT — uncited, which is the rule working`)
