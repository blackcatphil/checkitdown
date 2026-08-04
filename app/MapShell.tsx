'use client'

import 'maplibre-gl/dist/maplibre-gl.css'

/* MapLibre v6 has NO default export — verified against the shipped .mjs
   (`grep -c 'as default'` returns 0), not assumed from the v4 API. */
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  Map as MLMap,
  Popup,
} from 'maplibre-gl'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { applyGameFilter, visibleFilters } from '@/lib/game-filter'
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
const VALLEY: [number, number] = [-115.1709, 36.1309]
const VALLEY_Z = 10
const STRIP: [number, number] = [-115.1726, 36.1120]
const STRIP_Z = 14.5
const CLUSTER_RADIUS = 50
const PITCH = 52
/** Below this the camera flattens: the tile building layer carries no data
 *  lower, so a pitched empty view would be all cost and no skyline. */
const MIN_3D_ZOOM = 13.5

export function MapShell({ rooms }: { rooms: MapRoom[] }) {
  const holder = useRef<HTMLDivElement>(null)
  const mapRef = useRef<InstanceType<typeof MLMap> | null>(null)
  const hovered = useRef<string | number | null>(null)
  const rosterRef = useRef<MapRoom[]>([])
  const [checked, setChecked] = useState<string[]>([])
  const [season, setSeason] = useState(false)
  const [compare, setCompare] = useState<string[]>([])
  const [zoom, setZoom] = useState(STRIP_Z)
  const [ready, setReady] = useState(false)
  const [tilesIn, setTilesIn] = useState(false)
  const [inView, setInView] = useState<number | null>(null)

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

    const map = new MLMap({
      container: holder.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: STRIP,
      zoom: STRIP_Z,
      pitch: PITCH,
      bearing: -18,
      /* OSM's tile usage policy REQUIRES visible attribution. It was actively
         suppressed once already; MapLibre shows it by default and it stays. */
      attributionControl: { compact: false },
    })
    mapRef.current = map

    map.on('load', () => {
      /* Restyle every layer individually — the capability Leaflet lacked. That
         map toned raster tiles with a single CSS filter, a blunt instrument
         applied to a picture; here water, roads, labels and fills each take
         their own token. */
      for (const l of map.getStyle().layers ?? []) {
        const water = /water|ocean|river/i.test(l.id)
        try {
          if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', T.base)
          else if (l.type === 'fill') {
            map.setPaintProperty(l.id, 'fill-color', water ? T.water : T.surface)
            map.setPaintProperty(l.id, 'fill-opacity', water ? 1 : 0.5)
          } else if (l.type === 'line') {
            map.setPaintProperty(l.id, 'line-color', water ? T.water : T.line)
          } else if (l.type === 'symbol') {
            map.setPaintProperty(l.id, 'text-color', T.dim)
            map.setPaintProperty(l.id, 'text-halo-color', T.base)
          } else if (l.type === 'fill-extrusion') {
            map.setPaintProperty(l.id, 'fill-extrusion-opacity', 0)
          }
        } catch { /* a style layer rejecting a paint property is not fatal */ }
      }

      map.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
      /* The city. `render_height` is all the tiles expose — OpenMapTiles merges
         height= and building:levels upstream, which is why the height=-only
         rule is UNAVAILABLE rather than rejected. Podium-tagged resorts render
         short; upstream OSM edits are the only remaining lever. */
      map.addLayer({
        id: 'city',
        source: 'ofm',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': T.raised,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 0],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      })

      /* OUR OWN 17 footprints, picked deliberately by scripts/room-footprints.mjs.
         Hover lives here and ONLY here — never on tile feature-state, which
         would inherit missing ids, per-tile splitting and podium ambiguity. */
      map.addSource('fp', { type: 'geojson', data: ROOM_FOOTPRINTS as never, promoteId: 'slug' })
      map.addLayer({
        id: 'rooms-fp',
        source: 'fp',
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'hover'], false], T.value, T.pin] as ExpressionSpecification,
          'fill-extrusion-height': ['+', ['coalesce', ['get', 'height'], ['*', ['coalesce', ['get', 'levels'], 1], 3.2]], 3] as ExpressionSpecification,
          'fill-extrusion-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0.6] as ExpressionSpecification,
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

      map.on('mousemove', 'rooms-fp', (e) => {
        const f = e.features?.[0]
        if (!f) return
        if (hovered.current != null) map.setFeatureState({ source: 'fp', id: hovered.current }, { hover: false })
        hovered.current = f.id ?? null
        if (hovered.current != null) map.setFeatureState({ source: 'fp', id: hovered.current }, { hover: true })
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'rooms-fp', () => {
        if (hovered.current != null) map.setFeatureState({ source: 'fp', id: hovered.current }, { hover: false })
        hovered.current = null
        map.getCanvas().style.cursor = ''
      })
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
      setTilesIn(map.getZoom() >= 13 && map.areTilesLoaded()
        && map.queryRenderedFeatures({ layers: ['city'] }).length > 0)
      const b = map.getBounds()
      setInView(rosterRef.current.filter((r) => b.contains([r.longitude, r.latitude])).length)
    }
    map.on('moveend', check)
    map.on('idle', check)

    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; data flows in through the effects below
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
            <span className="cid-label">BUILDINGS LOADING</span>
            <p>
              {ready
                ? 'Tiles are still downloading. This is not the map telling you there is nothing here.'
                : 'Starting the map…'}
            </p>
          </div>
        )}

        <div className="num cid-mapbadge">
          z{zoom} · {roster.length} ROOMS · {in3d ? (tilesIn ? '3D' : '3D · LOADING') : `FLAT · 3D AT z${MIN_3D_ZOOM}`}
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
