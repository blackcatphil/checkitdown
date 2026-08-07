'use client'

import 'maplibre-gl/dist/maplibre-gl.css'

/* MapLibre v6 has NO default export — verified against the shipped .mjs
   (`grep -c 'as default'` returns 0), not assumed from the v4 API. */
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  Map as MLMap,
  Popup,
  setWorkerUrl,
} from 'maplibre-gl'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { applyGameFilter, visibleFilters } from '@/lib/game-filter'
import { applyPalette, type MapStyle } from '@/lib/map-style'
import { ROOM_FOOTPRINTS, ROOM_ROOFS, ROOM_SHELLS } from '@/lib/room-footprints'
import { createWireframeLayer, WIRE_STAGGER, type WireframeLayer } from '@/lib/wireframe'
import { inRoster, STATUS_LABEL, type RoomStatus } from '@/lib/roster'
import { MAP_TOKENS, readTokens } from '@/lib/tokens'

export type MapRoom = {
  slug: string
  name: string
  area: string
  status: RoomStatus
  is_seasonal: boolean
  latitude: number
  longitude: number
  table_count: number | null
  verified_at: string | null
  games: string[]
  stakes: string | null
}

/**
 * CONSTANTS RE-MEASURED FOR MAPLIBRE — not carried across from Leaflet.
 * See `node scripts/map-measure.mjs`, which uses the real supercluster.
 *
 * MapLibre tiles are 512px where Leaflet's were 256, so every zoom is one step
 * "closer" in pixel terms. Carrying z11 across would have been wrong before
 * anything else was considered.
 *
 * WHOLE VALLEY — z10, cluster radius 50: **8 rendered pins representing 17/17
 * rooms, 0 overlapping pairs, tightest edge gap 71.2px.** Radius 40 was
 * rejected: it produced overlaps at z9.5 and z10.5 (negative edge gaps),
 * because supercluster GRIDS rather than absorbing, so a smaller radius does
 * not guarantee separation the way the old absorption pass did.
 *
 * STRIP LANDING — z14.5 / pitch 52, matching the spike that was looked at in a
 * browser. A flat-viewport calculation says 5 rooms in frame; the spike observed
 * 8, because pitch extends the visible ground toward the horizon. The observed
 * figure is the real one — the computed one understates.
 */
type Diag = { requested: number; loaded: number; errored: number; lastFrame: number | null; since: number }
/** Flag-gated: the overlay and the `window.__cid_map` handle never ship. */
const MAP_DEBUG = process.env.NEXT_PUBLIC_MAP_DEBUG === '1'
/* AN OPTION TO COMPARE, NOT A DEFAULT. Gold on the whole road network read as a
   surface rather than an accent; the open question is whether the Strip ALONE
   still wants a restrained gold so the spine reads. Off unless asked for. */
const STRIP_GOLD = process.env.NEXT_PUBLIC_MAP_STRIP_GOLD === '1'
/* Verified against OSM rather than guessed: the Strip is tagged
   `South Las Vegas Boulevard`, highway=primary. "Las Vegas Blvd" matches
   nothing, and a filter that matches nothing renders an EMPTY layer that
   photographs exactly like a working one. */
const STRIP_NAME = 'South Las Vegas Boulevard'
/* HOW THE 3D MASSES ARE OUTLINED. fill-extrusion has no stroke, so there are
   two techniques and they look different enough to be worth comparing rather
   than choosing:
     cap   — a HOLLOW ring over the top 2 m of the mass, so the roof reads as an
             outline. A solid cap made the roofs gold slabs. DEFAULT.
     shell — the footprint buffered 2 m outward as a donut, extruded to the same
             height. MEASURED AND REJECTED, kept only so nobody proposes it
             again: at pitch the shell's outer wall stands IN FRONT of the mass
             at equal height, so it occludes rather than rims it. The buildings
             render solid gold with purple slivers on the far faces. The donut
             hole only helps looking straight down, and the map is pitched 52°.
     base  — footprint line only, the state before this pass.
   The footprint line at the base is drawn in every mode, so `cap` gives the
   volume a top edge and a bottom edge. */
const EDGE = process.env.NEXT_PUBLIC_MAP_EDGE ?? 'cap'
/* The vertical wireframe. On by default — it is the thing that makes the masses
   read as volumes rather than as blocks. */
const WIRE = process.env.NEXT_PUBLIC_MAP_WIRE !== '0'
/* How long the map must be genuinely still before the orbit resumes. */
const IDLE_MS = 30000
const DEG_PER_SEC = 0.9

const VALLEY: [number, number] = [-115.1709, 36.1309]
const VALLEY_Z = 10
const STRIP: [number, number] = [-115.1726, 36.1120]
const STRIP_Z = 14.5
const CLUSTER_RADIUS = 50
const PITCH = 52
/** Below this the camera flattens: the tile building layer carries no data
 *  lower, so a pitched empty view would be all cost and no skyline. */
const MIN_3D_ZOOM = 13.5
/* THE ZOOM AT WHICH THE BUILDING TAKES OVER FROM THE DOT.
   Same threshold as the 3D switch, deliberately: above it the camera pitches
   and the masses read as volumes, below it they are sub-pixel smudges and the
   clusters carry everything. One number rather than two, so "the mass renders"
   and "the mass is the target" can never disagree.
   Below this the locator is the only thing on screen for every room. Above it
   the dot is dropped ONLY for rooms that actually have a mass — the property
   that matters is that no room is unreachable at any zoom, and it is asserted
   in scripts/map-probe.mjs at both cameras. */
const MASS_ZOOM = MIN_3D_ZOOM
/* The invisible padded target around each footprint, in pixels of stroke. A
   small flat footprint is a WORSE target than the 7px dot it replaces, so the
   mass gets a floor: this pads outward from every edge, and the fill itself is
   clickable inside. */
const HIT_PAD = 16
/* Which rooms have a mass at all, derived from the footprints rather than kept
   as a second list that can drift out of step with them. */
const MASS_SLUGS = new Set(ROOM_FOOTPRINTS.features.map((f) => f.properties.slug as string))

/** Per-property bounding box of the mass, computed once. */
const MASS_BOUNDS = (() => {
  const m = new Map<string, [number, number, number, number]>()
  for (const f of ROOM_FOOTPRINTS.features) {
    const slug = f.properties.slug as string
    const b = m.get(slug) ?? [180, 90, -180, -90]
    for (const ring of f.geometry.coordinates as unknown as [number, number][][]) {
      for (const [x, y] of ring) {
        b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y)
        b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y)
      }
    }
    m.set(slug, b)
  }
  return m
})()
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

/** '#rrggbb' -> normalised rgba, because a GL uniform cannot take a CSS hex and
 *  the palette is the only place a colour is allowed to come from. */
function glColor(hex: string, alpha = 1): [number, number, number, number] {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(f.slice(0, 2), 16) / 255,
    parseInt(f.slice(2, 4), 16) / 255,
    parseInt(f.slice(4, 6), 16) / 255,
    alpha,
  ]
}

/** One query, three behaviours. Read at call time, not module load, so a user
 *  who changes the OS setting does not have to reload. */
const reduced = () => typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * THE KNOCK RING, thrown from a selected pin.
 *
 * The logo mark is a knuckle rap that throws rings and a map ping is the same
 * shape, so this reuses `knockR1`/`knockR2` from the design system rather than
 * inventing a second motion vocabulary — brand and map share one.
 */
function ping(map: InstanceType<typeof MLMap>, lngLat: [number, number]) {
  if (reduced()) return
  const parent = map.getCanvasContainer()
  const at = map.project(lngLat)
  const els = ['r1', 'r2'].map((r) => {
    const el = document.createElement('div')
    el.className = `cid-ping ${r}`
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
    parent.appendChild(el)
    return el
  })
  /* The ring is screen-positioned, so it would slide off its pin the moment the
     map moves. It is short-lived and follows the camera until it is done. */
  const follow = () => {
    const p = map.project(lngLat)
    for (const el of els) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px` }
  }
  map.on('move', follow)
  window.setTimeout(() => {
    map.off('move', follow)
    for (const el of els) el.remove()
  }, 1700)
}

/* The rise is STAGGERED, so 16 masses do not stand up as one slab. Each
   feature's start is offset by its id, and every factor still reaches 1. */
const STAGGER = WIRE_STAGGER
const riseFactor = (p: number) => ['max', 0, ['min', 1,
  ['/', ['-', p, ['*', STAGGER, ['/', ['%', ['id'], 8], 8]]], 1 - STAGGER]]] as ExpressionSpecification
const riseHeight = (p: number) => ['*', ['get', 'height'], riseFactor(p)] as ExpressionSpecification
const riseBase = (p: number) => ['max', 0, ['-', ['*', ['get', 'height'], riseFactor(p)], 2]] as ExpressionSpecification

const FULL_HEIGHT = ['get', 'height'] as ExpressionSpecification
const FULL_BASE = ['max', ['-', ['get', 'height'], 2], 0] as ExpressionSpecification


/**
 * DIM BEATS HOVER, DELIBERATELY.
 *
 * The filter is a statement about the room — "this one does not spread Omaha" —
 * and hovering should not appear to retract it. So `dim` is the FIRST arm of
 * every case below: a filtered-out mass stays dim while the pointer is over it,
 * and the popup still opens, which is where the room's actual detail lives.
 * The alternative (hover wins, the mass lights normally) makes the filter look
 * like it forgot. Either behaviour falls out of expression ORDER, so it is
 * stated here once rather than re-derived at five paint blocks.
 */
const dimFirst = (dim: string, hover: string, base: string): ExpressionSpecification =>
  ['case',
    ['boolean', ['feature-state', 'dim'], false], dim,
    ['boolean', ['feature-state', 'hover'], false], hover,
    base] as ExpressionSpecification

export function MapShell({ rooms }: { rooms: MapRoom[] }) {
  const holder = useRef<HTMLDivElement>(null)
  const roseRef = useRef(false)
  const lastActivity = useRef(0)
  const wireRef = useRef<WireframeLayer | null>(null)
  const mapRef = useRef<InstanceType<typeof MLMap> | null>(null)
  const hovered = useRef<string | null>(null)
  const rosterRef = useRef<MapRoom[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [season, setSeason] = useState(false)
  const [compare, setCompare] = useState<string[]>([])
  const [zoom, setZoom] = useState(STRIP_Z)
  const [ready, setReady] = useState(false)
  const [rose, setRose] = useState(false)
  const [tilesIn, setTilesIn] = useState(false)
  const [paletteOk, setPaletteOk] = useState(true)
  const [inView, setInView] = useState<number | null>(null)
  /* THE DEV INSTRUMENT. Three numbers, because the failure that cost weeks was
     invisible to all of the others: the style loaded, the console stayed clean,
     the canvas looked like a dark map, and NO TILE WAS EVER REQUESTED.
     `tiles requested 0 / last frame never` states that in two readings.
     Flag-gated so it never ships, but the counters are cheap and always run —
     an instrument you have to turn on before it starts counting misses the
     first seconds, which is exactly where load failures live. */
  const [diag, setDiag] = useState<Diag>({ requested: 0, loaded: 0, errored: 0, lastFrame: null, since: 0 })
  const diagRef = useRef<Diag>(diag)

  const roster = useMemo(
    () => rooms.filter((r) => (season ? r.status !== 'closed' : inRoster(r))),
    [rooms, season],
  )
  const { matches, activeKeys } = useMemo(
    () => applyGameFilter(roster, checked),
    [roster, checked],
  )
  const matched = useMemo(() => new Set(matches.map((r) => r.slug)), [matches])

  /* The map's `check` closure is created once and must read the CURRENT roster,
     so it goes through a ref — assigned in an effect, not during render. */
  useEffect(() => { rosterRef.current = roster }, [roster])

  /* Points carry `hit` so supercluster can total matches per cluster — that is
     what makes the partial "1/9" state possible at all. */
  const pointData = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: roster.map((r) => ({
      type: 'Feature' as const,
      properties: {
        slug: r.slug,
        name: r.name,
        hit: matched.has(r.slug) ? 1 : 0,
        /* Drives the pin's disappearance above MASS_ZOOM. Nine rooms had no
           footprint until this pass; if any room ever lacks one again, its dot
           simply keeps showing, which is the safe direction to fail. */
        hasMass: MASS_SLUGS.has(r.slug) ? 1 : 0,
        flagged: STATUS_LABEL[r.status] ? 1 : 0,
        badge: STATUS_LABEL[r.status] ?? '',
        verified: r.verified_at ? r.verified_at.slice(0, 10) : '',
        area: r.area,
        tables: r.table_count ?? 0,
        stakes: r.stakes ?? '',
      },
      geometry: { type: 'Point' as const, coordinates: [r.longitude, r.latitude] },
    })),
  }), [roster, matched])

  useEffect(() => {
    if (!holder.current || mapRef.current) return
    const T = readTokens(MAP_TOKENS)
    let cancelled = false

    /* SERVE THE WORKER OURSELVES. MapLibre v6 builds its worker from a Blob
       that imports `import.meta.url`; Turbopack rewrites that to the PAGE url,
       so the worker loaded this HTML document as its source and died on the
       spot. Vector tiles are fetched IN the worker, so the map requested none —
       while the style, the TileJSON and the sprites all returned 200 from the
       main thread and the console stayed empty.
       public/maplibre-gl-worker.mjs is generated by scripts/sync-map-worker.mjs
       and `npm run check:worker` fails the build if it drifts from the
       installed package. */
    setWorkerUrl('/maplibre-gl-worker.mjs')

    /* NO ResizeObserver HERE, ON PURPOSE — MapLibre v6 installs its own.
       The blank map was diagnosed as a 0x0 container measured once at
       construction, and an observer was the prescribed fix. Direct measurement
       said otherwise: the container was 1138x836 on the FIRST probe, before any
       change, and with our observer ablated the map still tracks a
       container-only resize. Adding it would have been a second path beside a
       working one, credited with a fix it did not make.
       scripts/map-probe.mjs still asserts the behaviour, because it matters
       whoever provides it. */

    const tick = setInterval(() => {
      const d = diagRef.current
      setDiag({ ...d, since: d.lastFrame === null ? -1 : Math.round(performance.now() - d.lastFrame) })
    }, 500)
    let map: InstanceType<typeof MLMap> | null = null

    /* Recolour the style BEFORE the map exists. The first version walked it
       after `load` and fired 83 setPaintProperty calls across 55 layers, each
       against a live map, each a style diff and a repaint. MapLibre fetches this
       JSON anyway — fetching it ourselves costs the same request and does the
       work once. */
    void (async () => {
      /* FALLBACK, because this step introduced a failure whose symptom is
         IDENTICAL to the one we already cannot diagnose: if the fetch or the
         transform throws, the map never constructs and the blank canvas looks
         exactly like the slow-load problem.
         So a failed palette hands MapLibre the style URL directly. The result
         is a correctly-rendered map in the WRONG COLOURS — visibly degraded,
         obviously diagnosable, still usable. A blank map tells you nothing; a
         Positron-coloured map tells you precisely which step failed. */
      let style: MapStyle | string = STYLE_URL
      try {
        const raw: MapStyle = await fetch(STYLE_URL).then((r) => {
          if (!r.ok) throw new Error(`style ${r.status}`)
          return r.json()
        })
        style = applyPalette(raw, T)
      } catch {
        style = STYLE_URL
        if (!cancelled) setPaletteOk(false)
      }
      if (cancelled || !holder.current) return
      map = new MLMap({
        container: holder.current,
        /* Counted HERE rather than in the probe, because the number that matters
           is the one the running app can show a human. */
        transformRequest: (url, kind) => {
          if (kind === 'Tile') diagRef.current.requested++
          return { url }
        },
        style: style as never,
        center: STRIP,
        zoom: STRIP_Z,
        pitch: PITCH,
        bearing: -18,
        /* OSM's tile usage policy REQUIRES visible attribution. It was actively
           suppressed once already; MapLibre shows it by default and it stays. */
        attributionControl: { compact: false },
      })
      mapRef.current = map
      map.on('render', () => { diagRef.current.lastFrame = performance.now() })
      /* DISTINCT TILES, not data events. `data` fires repeatedly per tile as it
         changes state, so counting events reported 48 loaded against 12
         requested — a badge that overstates is worse than no badge, because it
         is the badge you would trust while chasing something else. */
      const seenTiles = new Set<string>()
      map.on('data', (e) => {
        const key = (e as { tile?: { tileID?: { key?: string } } }).tile?.tileID?.key
        if (e.dataType === 'source' && key && !seenTiles.has(key)) {
          seenTiles.add(key)
          diagRef.current.loaded++
        }
      })
      /* AND IT MUST STILL SPEAK. Registering an `error` listener SUPPRESSES
         MapLibre's own console reporting — a counter that silently swallows the
         message would have made this failure harder to find, not easier. */
      map.on('error', (e) => {
        diagRef.current.errored++
        console.error('[map]', e.error?.message ?? e)
      })
      /* A HANDLE ON THE LIVE MAP. Diagnosing the no-tiles failure meant asking
         the map what it thought its own camera and sources were, and nothing
         exposed it — so the investigation ran on inference for far too long. */
      if (MAP_DEBUG) (window as unknown as { __cid_map?: unknown }).__cid_map = map
      wire(map, T)
    })()

    function wire(map: InstanceType<typeof MLMap>, T: Record<string, string>) {
    map.on('load', () => {
      /* NO TILE BUILDING LAYER. Extruding from tiles meant taking
         `render_height`, which OpenMapTiles pre-merges from height= and
         building:levels — that IS the MGM-Grand-as-a-two-storey-box problem.
         Owning the polygons gives back control of the heights, so the podium
         problem disappears rather than being documented as a known wart.
         The ground map stays as the style ships it. */

      /* OUR OWN 17 footprints, picked deliberately by scripts/room-footprints.mjs.
         Hover lives here and ONLY here — never on tile feature-state, which
         would inherit missing ids, per-tile splitting and podium ambiguity. */
      /* No promoteId: components share a slug, so the generated numeric ids are
         the only unique handle. Hover then lights the whole GROUP by slug. */
      if (STRIP_GOLD) {
        map.addLayer({
          id: 'strip-gold',
          source: 'openmaptiles',
          'source-layer': 'transportation_name',
          type: 'line',
          filter: ['==', ['get', 'name'], STRIP_NAME],
          paint: {
            'line-color': T.stripGold,
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 8] as ExpressionSpecification,
            'line-opacity': 0.9,
          },
        })
      }

      map.addSource('fp', { type: 'geojson', data: ROOM_FOOTPRINTS as never })
      /* THE FLAT-FOOTPRINT RULE IS LIVE AGAIN. It was marked moot only because
         the tiles offered no tagged/untagged distinction; with our own data it
         applies as originally reasoned. A polygon with a sourced height is
         extruded to it. A polygon without one renders FLAT — "there is a
         building here and we do not know its height" — never a volume
         synthesised from `building:levels`, which is the inflation path and the
         podium tag wearing a different hat. */
      map.addLayer({
        id: 'rooms-flat',
        minzoom: MASS_ZOOM,
        source: 'fp',
        type: 'fill',
        paint: {
          /* GOLD, NOT TEAL. Teal is --cid-value and means verified; spending it
             on a hover spends the only hue in the product that carries a claim. */
          'fill-color': dimFirst(T.massDim, T.hover, T.pin),
          /* 0.45 -> 0.55. A FLAT footprint has no walls to shade, so it carries
             the filter on fill and outline alone. At 0.45 a dimmed flat mass
             sat at 1.38 against the ground and 1.30 against its lit self —
             below the extruded case (1.63) and close to invisible, which for
             the nine rooms promoted in this pass would mean the filter had
             quietly stopped speaking for them. */
          'fill-opacity': 0.55,
          /* THE OUTLINE DOES THE WORK ON A FLAT SHAPE, and it was a STATIC
             lavender — a dimmed footprint would have kept a fully-lit edge,
             the same miss as the cap layer one layer over. */
          'fill-outline-color': dimFirst(T.massDim, T.hover, T.accent300),
        },
      })
      map.addLayer({
        id: 'rooms-fp',
        minzoom: MASS_ZOOM,
        source: 'fp',
        type: 'fill-extrusion',
        filter: ['has', 'height'],
        paint: {
          /* Colour, never opacity — `fill-extrusion-opacity` takes zoom
             expressions only and rejects feature-state outright (see below). */
          'fill-extrusion-color': dimFirst(T.massDim, T.hover, T.pin),
          'fill-extrusion-height': ['get', 'height'] as ExpressionSpecification,
          'fill-extrusion-base': 0,
          /* CONSTANT, because `fill-extrusion-opacity` takes zoom expressions
             only — a feature-state expression here is rejected outright:
             "data expressions not supported". Hover therefore rides on
             fill-extrusion-color, which does support feature-state.
             This error had been sitting behind the dead worker: the `load`
             event never fired, so this layer was never added, so the style
             error was never raised. One silent failure was hiding another. */
          'fill-extrusion-opacity': 0.8,
        },
      })

      /* THE GOLD EDGE. fill-extrusion has no outline property, so the footprint
         geometry is drawn again as a thin line. At pitch it traces the base of
         each mass, which is where the silhouette meets the ground and where the
         eye reads the footprint. Thin and on a line, so gold cannot spread into
         a field the way it did across the road network. */
      map.addLayer({
        id: 'rooms-edge',
        minzoom: MASS_ZOOM,
        source: 'fp',
        type: 'line',
        paint: {
          'line-color': dimFirst(T.litDim, T.hover, T.buildingLit),
          'line-width': 1.4,
          'line-opacity': 0.9,
        },
      })

      if (EDGE === 'shell' || EDGE === 'both') {
        map.addSource('shells', { type: 'geojson', data: ROOM_SHELLS as never })
        map.addLayer({
          id: 'rooms-shell',
          minzoom: MASS_ZOOM,
          source: 'shells',
          type: 'fill-extrusion',
          paint: {
            /* Was a FLAT colour with no case expression at all — the layer that
               would have kept a bright gold rim around a dimmed mass. */
            'fill-extrusion-color': dimFirst(T.litDim, T.hover, T.buildingLit),
            'fill-extrusion-height': ['get', 'height'] as ExpressionSpecification,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.9,
          },
        })
      }
      if (EDGE === 'cap' || EDGE === 'both') {
        /* A RING, NOT A SLAB. The first version extruded the whole footprint
           over the top 3 m, so its top face was the entire roof and every
           building wore a gold lid. This source is a donut — outer edge the real
           footprint, inner edge pulled in — so the top face is a ring and the
           roof reads as an outline. */
        map.addSource('roofs', { type: 'geojson', data: ROOM_ROOFS as never })
        map.addLayer({
          id: 'rooms-cap',
          minzoom: MASS_ZOOM,
          source: 'roofs',
          type: 'fill-extrusion',
          paint: {
            'fill-extrusion-color': dimFirst(T.litDim, T.hover, T.buildingLit),
            /* `max` keeps a short component from inverting base above height. */
            'fill-extrusion-base': ['max', ['-', ['get', 'height'], 2], 0] as ExpressionSpecification,
            'fill-extrusion-height': ['get', 'height'] as ExpressionSpecification,
            'fill-extrusion-opacity': 0.95,
          },
        })
      }

      /* THE VERTICAL EDGES. No built-in layer can draw an elevated line, so this
         is the custom-layer wireframe — triangle-expanded, because WebGL caps
         gl.lineWidth at 1 device pixel and a half-CSS-pixel hairline is not the
         gold outline anyone asked for. Added AFTER the extrusions so the depth
         buffer already holds the masses and edges behind them are discarded. */
      if (WIRE) {
        const feats = (ROOM_FOOTPRINTS.features as unknown as Array<{
          geometry: { coordinates: [number, number][][] }
          properties: { height?: number; slug: string }
          id: number
        }>)
          .filter((f) => f.properties.height)
          .map((f) => ({
            ring: f.geometry.coordinates[0],
            height: f.properties.height as number,
            /* THE SAME STAGGER THE MASSES GET, from the same constant and the
               same id arithmetic. Two copies of this number is precisely how
               edges end up floating above buildings that have not risen yet. */
            stagger: STAGGER * ((f.id % 8) / 8),
            slug: f.properties.slug,
          }))
        const wire = createWireframeLayer('rooms-wire', feats, {
          colorDim: glColor(T.litDim, 0.95),
          width: 2.4,
          /* 1.2 m OUT, plus a small depth bias in the shader. Measured: neither
             alone is enough. Offset alone needs ~5 m before the flicker stops,
             and at 5 m the cage visibly floats off the building; bias alone
             needs so much that it punches through the mass and becomes the
             x-ray box. Together, at values where each is small, the jitter
             lands on the no-wireframe baseline. */
          offsetMetres: Number(process.env.NEXT_PUBLIC_MAP_WIRE_OFFSET ?? '1.2'),
          color: glColor(T.buildingLit, 0.95),
        })
        /* Starts at 0, not 1: the layer is added while the masses are still
           flat, and an edge cage standing at full height around nothing is the
           exact artefact this is meant to avoid. */
        wire.setProgress(0)
        wireRef.current = wire
        map.addLayer(wire as never)
      }

      /* THE HIT FLOOR. Skyline's footprint is a few pixels across at the
         landing zoom — smaller than the 7px dot it replaces — so removing the
         dot without this would make a room HARDER to reach, which is the one
         outcome this change must not have. A wide, all-but-invisible stroke
         pads every footprint outward; the fill covers the inside.
         Not opacity 0: a zero-opacity layer is a layer somebody later "cleans
         up", and its being hit-testable is then a coincidence rather than a
         decision. 0.01 is invisible and obviously deliberate. */
      map.addLayer({
        id: 'rooms-hit',
        source: 'fp',
        type: 'line',
        minzoom: MASS_ZOOM,
        paint: {
          'line-color': T.pin,
          'line-width': HIT_PAD,
          'line-opacity': 0.01,
        },
      })

      map.addSource('rooms', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: 13,
        clusterProperties: { hits: ['+', ['get', 'hit']] },
      })

      map.addLayer({
        id: 'clusters',
        source: 'rooms',
        filter: ['has', 'point_count'],
        type: 'circle',
        paint: {
          'circle-radius': 22,
          'circle-color': ['case', ['<', ['get', 'hits'], ['get', 'point_count']], T.surface, T.accent] as ExpressionSpecification,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'hits'], 0], T.line,
            ['<', ['get', 'hits'], ['get', 'point_count']], T.clusterPartial,
            T.accent300,
          ] as ExpressionSpecification,
        },
      })
      /* Three states. The number does the work dimming cannot: at entry zoom
         the Strip is one pin, and "some of these match" has no shade. */
      map.addLayer({
        id: 'cluster-count',
        source: 'rooms',
        filter: ['has', 'point_count'],
        type: 'symbol',
        layout: {
          'text-field': [
            'case',
            ['==', ['get', 'hits'], ['get', 'point_count']], ['to-string', ['get', 'point_count']],
            ['concat', ['to-string', ['get', 'hits']], '/', ['to-string', ['get', 'point_count']]],
          ] as ExpressionSpecification,
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
        },
        paint: {
          'text-color': ['case', ['<', ['get', 'hits'], ['get', 'point_count']], T.clusterPartial, T.text] as ExpressionSpecification,
        },
      })
      map.addLayer({
        id: 'pin',
        /* Set imperatively on zoom change rather than with a ["zoom"] filter:
           zoom expressions inside a filter are evaluated per tile at integer
           zooms, which would flip the dot a whole zoom level away from where
           the mass appears. */
        source: 'rooms',
        filter: ['!', ['has', 'point_count']],
        type: 'circle',
        paint: {
          /* Filtering DIMS, never removes — a room that vanishes reads as
             "we don't have it" rather than "it doesn't match". */
          'circle-radius': 7,
          'circle-color': ['case', ['==', ['get', 'hit'], 1], T.accent300, T.pinDim] as ExpressionSpecification,
          'circle-stroke-width': ['case', ['==', ['get', 'flagged'], 1], 2, 1] as ExpressionSpecification,
          'circle-stroke-color': ['case', ['==', ['get', 'flagged'], 1], T.accent300, T.base] as ExpressionSpecification,
        },
      })

      /* Hovering any component lights the WHOLE property — ARIA's podium and
         its tower are one building to a reader, and lighting half of it would
         be the group model leaking through as a rendering artefact. */
      const setGroupHover = (slug: string | null) => {
        if (hovered.current === slug) return
        for (const f of ROOM_FOOTPRINTS.features) {
          if (f.properties.slug === hovered.current) map.setFeatureState({ source: 'fp', id: f.id }, { hover: false })
        }
        hovered.current = slug
        if (slug) {
          for (const f of ROOM_FOOTPRINTS.features) {
            if (f.properties.slug === slug) map.setFeatureState({ source: 'fp', id: f.id }, { hover: true })
          }
        }
      }
      for (const layer of ['rooms-fp', 'rooms-flat']) {
        map.on('mousemove', layer, (e) => {
          const slug = e.features?.[0]?.properties?.slug
          if (slug) setGroupHover(String(slug))
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          setGroupHover(null)
          map.getCanvas().style.cursor = ''
        })
      }
      map.on('click', 'clusters', (e) => {
        const f = e.features?.[0]
        if (f) map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: map.getZoom() + 2 })
      })
      /* THE BUILDING IS THE TARGET. Any component of the property group opens
         the room — ARIA's podium and its tower are one building to a reader, so
         clicking either does the same thing. The popup is anchored at the
         CLICK, not at the footprint centroid: a long mass like Mandalay Bay
         would otherwise pop up a long way from the pointer. */
      for (const layer of ['rooms-hit', 'rooms-flat', 'rooms-fp']) {
        map.on('click', layer, (e) => {
          const slug = e.features?.[0]?.properties?.slug
          if (!slug) return
          const room = rosterRef.current.find((r) => r.slug === slug)
          if (!room) return
          new Popup({ className: 'cid-popup', closeButton: false, offset: 12 })
            .setLngLat(e.lngLat)
            .setHTML(popupHtml({
              slug: room.slug,
              name: room.name,
              area: room.area,
              tables: room.table_count ?? 0,
              stakes: room.stakes ?? '',
              verified: room.verified_at ? room.verified_at.slice(0, 10) : '',
              badge: STATUS_LABEL[room.status] ?? '',
            }))
            .addTo(map)
        })
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
      }

      map.on('click', 'pin', (e) => {
        const f = e.features?.[0]
        if (!f) return
        ping(map, (f.geometry as GeoJSON.Point).coordinates as [number, number])
        new Popup({ className: 'cid-popup', closeButton: false, offset: 12 })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(popupHtml(f.properties as Record<string, string | number>))
          .addTo(map)
      })

      /* DUSK SKY + A LOW SUN. `setSky` paints the horizon behind the towers and
         `setLight` rakes the extrusion faces, which is what turns a flat dark
         plane into a place at night. The horizon colour is held below building
         luminance by token, and the luminance chain now asserts it — a sky is
         the one surface big enough to break "the brightest thing is a building"
         without anything noticing. */
      map.setSky({
        'sky-color': T.sky,
        'horizon-color': T.horizon,
        'fog-color': T.fog,
        'sky-horizon-blend': 0.55,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.08,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 0.3] as ExpressionSpecification,
      })
      /* INTENSITY 0.22, NOT 0.4. At 0.4 the warm light lifted every extrusion
         face toward the light's own hue and the aubergine masses came out dusty
         pink — the buildings stopped being the accent colour. Low enough to
         rake, not to repaint. */
      map.setLight({ anchor: 'map', color: T.light, intensity: 0.22, position: [1.6, 205, 32] })

      setReady(true)
    })

    /* An empty view means OPPOSITE things depending on whether tiles have
       arrived, and nothing on screen distinguishes them — so this tracks both
       and the UI says which. Structural, not cosmetic. */
    /* THE DOT GIVES WAY TO ITS OWN BUILDING, AND ONLY THEN.
       The first version dropped the dot for every room that HAS a footprint
       once past MASS_ZOOM. Orleans then became unreachable at the Strip
       camera: its marker sits inside the viewport but its building does not,
       so the dot vanished and nothing took over. "Has a mass" and "its mass is
       on screen" are different statements, and only the second one can
       justify removing the locator.
       So the pin list is recomputed from what is ACTUALLY RENDERED each time
       the camera settles — cheap, because it rides the existing moveend/idle
       pass, and correct by construction rather than by a zoom guess. */
    const yieldPins = () => {
      if (!map.getLayer('pin')) return
      if (map.getZoom() < MASS_ZOOM) { map.setFilter('pin', null); return }
      /* GEOMETRY, NOT A RENDER QUERY. queryRenderedFeatures answers differently
         depending on how far through a frame it is asked — at moveend it
         returned every slug in the source and the map lost all its locators; at
         idle it still disagreed with the same query run moments later, and
         Orleans kept losing its dot while its building was off screen.
         A footprint's bounding box against the viewport is the same answer
         every time it is asked, which is what this needs to be. */
      /* PROJECTED TO THE SCREEN, not compared in lng/lat. `getBounds()` at
         pitch 52 returns a trapezoid big enough to contain every room in the
         valley, so a lng/lat test said "on screen" for all seventeen and the
         map lost its locators again. Projection is what the camera actually
         does. */
      const canvas = map.getCanvas()
      const W = canvas.clientWidth, H = canvas.clientHeight
      const onScreen = (x: number, y: number) => {
        const p = map.project([x, y])
        return p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H
      }
      const covered: string[] = []
      for (const [slug, [minX, minY, maxX, maxY]] of MASS_BOUNDS) {
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
        /* Corners AND centre: a mass can straddle the edge with every corner
           outside, and one whose centre alone is visible is still a target. */
        if (onScreen(minX, minY) || onScreen(maxX, minY)
          || onScreen(minX, maxY) || onScreen(maxX, maxY) || onScreen(cx, cy)) {
          covered.push(slug)
        }
      }
      map.setFilter('pin', ['all',
        ['!', ['has', 'point_count']],
        ['!', ['in', ['get', 'slug'], ['literal', covered]]],
      ])
    }

    const check = () => {
      setZoom(Number(map.getZoom().toFixed(2)))
      /* Our footprints are bundled, so they paint immediately. What can still
         be missing is the GROUND MAP, and a blank ground is as ambiguous as a
         blank skyline was. */
      setTilesIn(map.areTilesLoaded())
      const b = map.getBounds()
      setInView(rosterRef.current.filter((r) => b.contains([r.longitude, r.latitude])).length)
    }
    map.on('moveend', check)
    map.on('idle', check)
    /* ON `idle` ONLY, NEVER `moveend`. queryRenderedFeatures on a source that
       has not finished rendering answers with everything in it: at moveend the
       drawn set came back as all seventeen slugs, the filter excluded every
       pin, and the map lost its locators entirely at the landing zoom. `idle`
       is the event that means "what you see is what is drawn". */
    map.on('moveend', yieldPins)
    map.on('idle', yieldPins)

    }

    return () => {
      cancelled = true
      clearInterval(tick)
      map?.remove()
      mapRef.current = null
    }
    /* Created once; data flows in through the effects below. The
       exhaustive-deps suppression that used to sit here is gone because the
       rule no longer fires — a stale disable directive is a claim about the
       code that nothing checks. */
  }, [])

  /* THE BUILDINGS RISE — but only once the GROUND HAS ARRIVED.
     Playing it on mount would run the animation into an empty frame: the whole
     point is the towers standing up out of a map, and with no map underneath it
     reads as jank rather than as arrival. `tilesIn` already tracks exactly this,
     because the loading state needed the same distinction.
     MapLibre does not ease paint properties, so this is a rAF loop over an
     expression. 16 masses is nothing. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !tilesIn || roseRef.current) return
    roseRef.current = true

    const settle = () => {
      wireRef.current?.setProgress(1)
      map.setPaintProperty('rooms-fp', 'fill-extrusion-height', FULL_HEIGHT)
      if (map.getLayer('rooms-cap')) {
        map.setPaintProperty('rooms-cap', 'fill-extrusion-height', FULL_HEIGHT)
        map.setPaintProperty('rooms-cap', 'fill-extrusion-base', FULL_BASE)
      }
    }
    if (reduced()) {
      /* Settle immediately, but hand the state change to the next frame:
         setting state synchronously inside an effect cascades renders, and the
         linter is right that it is a real hazard rather than a style note. */
      settle()
      const id = requestAnimationFrame(() => setRose(true))
      return () => cancelAnimationFrame(id)
    }

    const DUR = 950
    const t0 = performance.now()
    let raf = 0
    let done = false
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / DUR)
      const p = 1 - (1 - t) ** 3
      map.setPaintProperty('rooms-fp', 'fill-extrusion-height', riseHeight(p))
      if (map.getLayer('rooms-cap')) {
        map.setPaintProperty('rooms-cap', 'fill-extrusion-height', riseHeight(p))
        map.setPaintProperty('rooms-cap', 'fill-extrusion-base', riseBase(p))
      }
      /* ONE progress value drives both. The shader recomputes the same stagger
         curve, so an edge is never drawn at a height its mass has not reached. */
      wireRef.current?.setProgress(p)
      if (t < 1) { raf = requestAnimationFrame(frame); return }
      done = true
      settle()
      setRose(true)
    }
    raf = requestAnimationFrame(frame)
    /* THE CLEANUP MUST LAND THE BUILDINGS, not just stop the loop.
       This effect depends on `tilesIn`, and `tilesIn` FLIPS BACK TO FALSE the
       moment the camera drift rotates far enough to need new tiles. That
       cancelled the rise at p=0.17 and the `roseRef` guard then refused to
       restart it, so 16 towers sat permanently at a sixth of their height with
       nothing reporting a problem. Cancelling an animation is not the same as
       finishing it. */
    return () => {
      cancelAnimationFrame(raf)
      if (!done) { settle(); setRose(true) }
    }
  }, [ready, tilesIn])

  /* AMBIENT DRIFT — runs on arrival, stops on a real interaction, returns when
     the map is genuinely idle.
     THE ARRIVAL DRIFT IS UNCONDITIONAL. The previous version ran one loop for
     both jobs, so the same `busy()` test that (correctly) blocks a RESTART also
     gated the very first start — and merely moving the mouse onto the map
     stamped activity. In a browser nobody is holding still: the map loads, the
     pointer arrives, and the welcome drift never happens. Locally it always
     looked fine, because a headless mouse does not move.
     So arrival is separate, and only a real interaction — pointerdown, wheel,
     touch, key — stops it. Pointer MOVEMENT is activity for the restart clock
     only; it does not stop a drift already running, because moving the mouse
     across a map is not asking the map to stop. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !rose || reduced()) return

    const el = map.getCanvasContainer()
    let raf: number | null = null
    let startedAt = 0
    let last = 0
    let stopped = false

    const running = () => raf !== null
    const blocked = () => Boolean(
      document.querySelector('.maplibregl-popup')      // reading a room
      || Date.now() - lastActivity.current < IDLE_MS,  // something just happened
    )

    const frame = (now: number) => {
      /* Eased in over a second: snapping into motion after stillness reads as a
         glitch rather than as drift. */
      const ramp = Math.min(1, (now - startedAt) / 1000)
      map.setBearing(map.getBearing() + (DEG_PER_SEC * ramp * (now - last)) / 1000)
      last = now
      raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (running()) return
      startedAt = performance.now()
      last = startedAt
      raf = requestAnimationFrame(frame)
    }
    const halt = () => {
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
    }

    start()                       // the welcome, unconditionally

    const interact = () => { stopped = true; lastActivity.current = Date.now(); halt() }
    const moved = () => { lastActivity.current = Date.now() }
    for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const) {
      el.addEventListener(ev, interact, { passive: true })
    }
    el.addEventListener('pointermove', moved, { passive: true })

    const tick = window.setInterval(() => {
      if (!stopped || running() || blocked()) return
      start()
    }, 1000)

    return () => {
      window.clearInterval(tick)
      halt()
      for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const) {
        el.removeEventListener(ev, interact)
      }
      el.removeEventListener('pointermove', moved)
    }
  }, [rose])

  /* A filter change is activity even though it happens in the panel, where the
     canvas listeners never see it.
     THE FIRST RUN IS NOT A CHANGE. Stamping on mount made the map count as
     just-used for the first 30 seconds, so the arrival drift — the part Phil
     actually liked — silently stopped happening. An effect that fires on mount
     as well as on change is the ordinary shape of this bug. */
  const filtersMounted = useRef(false)
  useEffect(() => {
    if (!filtersMounted.current) { filtersMounted.current = true; return }
    lastActivity.current = Date.now()
  }, [checked])

  /* THE FILTER DIM REACHES THE BUILDING.
     In 3D the building IS the room — the same reasoning that turned the pin
     into a locator — so a room filtered out dims its whole mass, not just its
     7px dot. Driven from feature-state per SLUG, exactly like setGroupHover:
     ARIA's podium and tower carry one slug between them and change together.
     Lighting or dimming half a property is the group model leaking out.
     ADDITIVE, NOT A REPLACEMENT. Only 8 of 17 rooms have a footprint at all —
     the four locals rooms, Golden Nugget, MGM Grand, Orleans, Westgate and
     Skyline have no mass to dim. The pin keeps carrying filter state for every
     room, so those nine still answer the filter. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const dimmed = new Set(rosterRef.current.filter((r) => !matched.has(r.slug)).map((r) => r.slug))
    const apply = (source: string, features: ReadonlyArray<{ id: number; properties: { slug: string } }>) => {
      if (!map.getSource(source)) return
      for (const f of features) {
        map.setFeatureState({ source, id: f.id }, { dim: dimmed.has(f.properties.slug) })
      }
    }
    apply('fp', ROOM_FOOTPRINTS.features as never)
    apply('shells', ROOM_SHELLS.features as never)
    apply('roofs', ROOM_ROOFS.features as never)
    /* The wireframe is a custom GL layer and cannot read feature-state, so the
       same set goes in as a per-vertex attribute. */
    wireRef.current?.setDimmed(dimmed)
    map.triggerRepaint()
  }, [matched, ready])

  /* Cluster properties are computed at LOAD time, so `hits` cannot be
     repainted when the filter changes — the data has to be re-set. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource('rooms') as GeoJSONSource | undefined)?.setData(pointData)
    const b = map.getBounds()
    setInView(roster.filter((r) => b.contains([r.longitude, r.latitude])).length)
  }, [pointData, ready, roster])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    wireRef.current?.setVisible(zoom >= MASS_ZOOM)

    const want = zoom >= MIN_3D_ZOOM ? PITCH : 0
    if (Math.abs(map.getPitch() - want) > 1) map.easeTo({ pitch: want, duration: 400 })
  }, [zoom, ready])

  /* THE STRIP / WHOLE VALLEY ARE USER INTENT, so they kill the drift outright.
     The pointer listener on the canvas never sees these — they are panel
     buttons — and an ambient orbit that keeps turning the camera after somebody
     asked for a specific view is the map arguing with them. */
  const stopDrift = useCallback(() => { lastActivity.current = Date.now() }, [])
  const goStrip = useCallback(() => {
    stopDrift()
    mapRef.current?.easeTo({ center: STRIP, zoom: STRIP_Z, pitch: PITCH, bearing: -18 })
  }, [stopDrift])
  const goValley = useCallback(() => {
    stopDrift()
    mapRef.current?.easeTo({ center: VALLEY, zoom: VALLEY_Z, pitch: 0, bearing: 0 })
  }, [stopDrift])

  const toggle = (k: string) =>
    setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))
  const toggleCompare = (slug: string) =>
    setCompare((c) => (c.includes(slug) ? c.filter((x) => x !== slug) : [...c, slug]))

  const in3d = zoom >= MIN_3D_ZOOM

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--cid-panel-w) minmax(0,1fr)', height: 'calc(100vh - var(--cid-header-h))' }}>
      <aside
        style={{
          background: 'var(--cid-ink-700)', borderRight: '1px solid var(--cid-line-2)',
          padding: 'var(--cid-space-6)', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)',
        }}
      >
        <div>
          <p className="num" style={{ font: 'var(--cid-num-lg)', margin: 0 }}>
            {activeKeys.length ? `${matches.length} of ${roster.length} rooms match` : `${roster.length} rooms`}
          </p>
          {/* Only when it differs — the count and the viewport must not
              contradict each other on the first screen anyone sees. */}
          {inView != null && inView < roster.length && (
            <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-3) 0 0' }}>
              Showing {inView} of {roster.length} on screen —{' '}
              <button type="button" onClick={goValley} className="cid-inline-btn">see the whole valley</button>
            </p>
          )}
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-2) 0 0' }}>
            {activeKeys.length
              ? 'Rooms without every checked game stay on the map, dimmed.'
              : 'Check a game to dim the rooms that lack it.'}
          </p>
        </div>

        {/* Peers, not a primary and a way back: the valley view is where
            "every poker room in the valley" is something you can count. */}
        <div style={{ display: 'flex', gap: 'var(--cid-space-3)' }}>
          <button type="button" onClick={goStrip} className="cid-viewbtn">THE STRIP</button>
          <button type="button" onClick={goValley} className="cid-viewbtn">WHOLE VALLEY</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
          <span className="cid-label">GAMES</span>
          {visibleFilters(roster).map(([k, label]) => {
            const n = matches.filter((r) => r.games.includes(k)).length
            const on = checked.includes(k)
            return (
              <button key={k} type="button" onClick={() => toggle(k)} className="cid-check" data-on={on ? 'true' : 'false'}>
                <span aria-hidden className="cid-box">{on ? '✓' : ''}</span>
                <span style={{ flex: 1 }}>{label}</span>
                <span className="num" style={{ font: 'var(--cid-tag)', color: n ? 'var(--cid-dim)' : 'var(--cid-disabled)' }}>{n}</span>
              </button>
            )
          })}
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0 }}>
            Only games are filterable today. A dim means a room does not have it — and
            amenity coverage is not yet complete enough for that to be true.
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--cid-space-4)', minHeight: 'var(--cid-target)', font: 'var(--cid-body)', color: 'var(--cid-text-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={season} onChange={(e) => setSeason(e.target.checked)} />
          Include series-only rooms
        </label>

        {compare.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-3)' }}>
            <span className="cid-label">
              {compare.length === 1 ? '1 ROOM TO COMPARE' : `${compare.length} ROOMS TO COMPARE`}
            </span>
            {compare.map((slug) => (
              <div key={slug} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', font: 'var(--cid-body)' }}>
                <span>{rooms.find((r) => r.slug === slug)?.name}</span>
                <button type="button" onClick={() => toggleCompare(slug)} className="cid-inline-btn">REMOVE</button>
              </div>
            ))}
            <Link href={`/facts?compare=${compare.join(',')}`} style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-action)' }}>
              COMPARE ON JUST THE FACTS
            </Link>
          </div>
        )}
      </aside>

      <div style={{ position: 'relative' }}>
        <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
        {/* Above the canvas, below the panel and popups; pointer-events none so
            it cannot swallow a click on a pin. */}
        {in3d && <div className="cid-mapfog" aria-hidden />}

        {/* "No buildings" and "buildings not downloaded yet" look identical on
            screen and mean opposite things. The instrument cannot tell them
            apart on its own, so it says which one it is. */}
        {in3d && !tilesIn && (
          <div className="cid-maploading">
            <span className="cid-label">MAP LOADING</span>
            <p>
              {ready
                ? 'Ground tiles are still downloading. This is not the map telling you there is nothing here.'
                : 'Starting the map…'}
            </p>
          </div>
        )}

        <div className="num cid-mapbadge">
          z{zoom} · {roster.length} ROOMS · {in3d ? '3D' : `FLAT · 3D AT z${MIN_3D_ZOOM}`}
          {tilesIn ? '' : ' · LOADING'}
          {/* Degraded, not broken — and it says which. */}
          {paletteOk ? '' : ' · PALETTE FAILED'}
          {MAP_DEBUG
            ? ` · tiles ${diag.requested}/${diag.loaded}${diag.errored ? ` err ${diag.errored}` : ''}`
              + ` · frame ${diag.since < 0 ? 'NEVER' : `${diag.since}ms ago`}`
              /* "The drift is not running" has two causes that look identical:
                 reduced motion, and a stopped drift. The badge says which. */
              + ` · motion ${reduced() ? 'REDUCED' : 'full'}`
            : ''}
        </div>
      </div>
    </div>
  )
}

/** The popup carries provenance; the pin does not. A pin marks a location,
 *  which is not a claim that can be verified or ranked. */
function popupHtml(p: Record<string, string | number>) {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  return `
    <div class="cid-pop">
      ${p.badge ? `<span class="cid-pop-flag">${esc(p.badge)}</span>` : ''}
      <a class="cid-pop-name" href="/rooms/${esc(p.slug)}">${esc(p.name)}</a>
      <span class="cid-pop-meta">${esc(String(p.area).replace('_', '-'))}${p.tables ? ` · ~${esc(p.tables)} tables` : ''}</span>
      ${p.stakes ? `<span class="cid-pop-meta">~${esc(p.stakes)}</span>` : ''}
      <span class="cid-pop-ver">${p.verified ? `VERIFIED ${esc(p.verified)}` : 'UNVERIFIED'}</span>
      <a class="cid-pop-cta" href="/rooms/${esc(p.slug)}">OPEN FULL DETAILS</a>
    </div>`
}
