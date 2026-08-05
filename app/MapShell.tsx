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
import { ROOM_FOOTPRINTS } from '@/lib/room-footprints'
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

const VALLEY: [number, number] = [-115.1709, 36.1309]
const VALLEY_Z = 10
const STRIP: [number, number] = [-115.1726, 36.1120]
const STRIP_Z = 14.5
const CLUSTER_RADIUS = 50
const PITCH = 52
/** Below this the camera flattens: the tile building layer carries no data
 *  lower, so a pitched empty view would be all cost and no skyline. */
const MIN_3D_ZOOM = 13.5
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export function MapShell({ rooms }: { rooms: MapRoom[] }) {
  const holder = useRef<HTMLDivElement>(null)
  const mapRef = useRef<InstanceType<typeof MLMap> | null>(null)
  const hovered = useRef<string | null>(null)
  const rosterRef = useRef<MapRoom[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [season, setSeason] = useState(false)
  const [compare, setCompare] = useState<string[]>([])
  const [zoom, setZoom] = useState(STRIP_Z)
  const [ready, setReady] = useState(false)
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
        source: 'fp',
        type: 'fill',
        paint: {
          'fill-color': ['case', ['boolean', ['feature-state', 'hover'], false], T.value, T.pin] as ExpressionSpecification,
          'fill-opacity': 0.45,
          'fill-outline-color': T.accent300,
        },
      })
      map.addLayer({
        id: 'rooms-fp',
        source: 'fp',
        type: 'fill-extrusion',
        filter: ['has', 'height'],
        paint: {
          'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hover'], false], T.value, T.pin] as ExpressionSpecification,
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
      map.on('click', 'pin', (e) => {
        const f = e.features?.[0]
        if (!f) return
        new Popup({ className: 'cid-popup', closeButton: false, offset: 12 })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(popupHtml(f.properties as Record<string, string | number>))
          .addTo(map)
      })

      setReady(true)
    })

    /* An empty view means OPPOSITE things depending on whether tiles have
       arrived, and nothing on screen distinguishes them — so this tracks both
       and the UI says which. Structural, not cosmetic. */
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
    const want = zoom >= MIN_3D_ZOOM ? PITCH : 0
    if (Math.abs(map.getPitch() - want) > 1) map.easeTo({ pitch: want, duration: 400 })
  }, [zoom, ready])

  const goStrip = useCallback(() => {
    mapRef.current?.easeTo({ center: STRIP, zoom: STRIP_Z, pitch: PITCH, bearing: -18 })
  }, [])
  const goValley = useCallback(() => {
    mapRef.current?.easeTo({ center: VALLEY, zoom: VALLEY_Z, pitch: 0, bearing: 0 })
  }, [])

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
