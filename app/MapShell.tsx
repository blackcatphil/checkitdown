'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { inRoster, STATUS_LABEL, type RoomStatus } from '@/lib/roster'
import { MAP_TOKENS, readTokens } from '@/lib/tokens'

import { drawMassing, makeProjector, MIN_3D_ZOOM, type Palette } from './massing-layer'

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
 * HOME VIEW — measured against REAL coordinates, not inherited from the mock.
 * See scripts/map-fit.mjs. The valley is 26 x 29 km with 8 of 17 rooms inside
 * ~4 km of Strip, so at z11 all 17 fit the crop and absorption yields 10
 * rendered pins whose closest pair is 34.6px — no two rendered pins overlap.
 */
const VALLEY: [number, number] = [36.1309, -115.1709]
const VALLEY_Z = 11
/**
 * LANDING = the Strip, because the skyline is the front door.
 *
 * z14.5 chosen on evidence, not defaulted (scripts/map-tilt.mjs, Strip centre):
 *   z14   lean 10px · 10/17 in view · 9 pins · closest 58.2px · 0 overlaps
 *   z14.5 lean 14px ·  9/17 in view · 9 pins · closest 42.8px · 0 overlaps
 *   z15   lean 20px ·  6/17 in view · 6 pins · closest 58.5px · 0 overlaps
 * z14 is the honesty FLOOR and shows the weakest version of the thing we land
 * here to show. z15 buys 6px more lean and costs a THIRD of the visible roster.
 * z14.5 is the lowest zoom where the massing meaningfully reads while over half
 * the roster is still on screen.
 */
const STRIP: [number, number] = [36.1120, -115.1726]
const STRIP_Z = 14.5
/**
 * Clustering is FORCED by the geography here, so clusters are permanent
 * furniture rather than an edge case — they get their own size and a ring so
 * "8 rooms, tap to open" reads as a different object, not a labelled pin.
 *
 * Absorption must clear the widest pair: clusterR + singleR = 22 + 16 = 38, so
 * 40 for a visible gap. Re-measured after the size step (scripts/map-fit.mjs):
 * home z11 now yields 9 rendered pins for 17/17 rooms, 0 overlapping pairs,
 * tightest edge gap 20.6px. The step costs one room — The Orleans is absorbed
 * into the Strip cluster, which becomes 8.
 */
const SINGLE = 32
const CLUSTER = 44
const PIN = 40

/** The panel ships with GAMES only — see the coverage-gate decision. The SAME
 *  gate applies one level down, within GAMES: a checkbox no room can satisfy is
 *  a broken control, not an honest one. No room currently spreads `mixed`, so
 *  "Mixed games" is filtered out below rather than shipped reading 0. */
const GAME_FILTERS: Array<[string, string]> = [
  ['nlh', "No-Limit Hold'em"],
  ['plo', 'Pot-Limit Omaha'],
  ['limit', "Limit hold'em"],
  ['mixed', 'Mixed games'],
]

type Placed = { x: number; y: number; members: MapRoom[] }

export function MapShell({ rooms }: { rooms: MapRoom[] }) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [season, setSeason] = useState(false)
  const [compare, setCompare] = useState<string[]>([])
  const [zoom, setZoom] = useState(STRIP_Z)
  const [tick, setTick] = useState(0)
  const [want3d, setWant3d] = useState(true)
  const [inView, setInView] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paletteRef = useRef<Palette | null>(null)
  /* Tier B engages only when zoomed in. Below MIN_3D_ZOOM the pin layer owns
     the view unchanged — wiring 3D must not regress the measured Tier A fit. */
  const on3d = want3d && zoom >= MIN_3D_ZOOM

  /* Seasonal rooms are OFF the roster by default and restored by this toggle —
     a locked decision that lived only in prose until the read paths enforced it. */
  const roster = useMemo(
    () => rooms.filter((r) => (season ? r.status !== 'closed' : inRoster(r))),
    [rooms, season],
  )

  const matches = useMemo(
    () => (checked.length === 0
      ? roster
      : roster.filter((r) => checked.every((k) => r.games.includes(k)))),
    [roster, checked],
  )
  const matched = useMemo(() => new Set(matches.map((r) => r.slug)), [matches])

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const t = readTokens(MAP_TOKENS)
    paletteRef.current = t
    const map = L.map(mapEl.current, {
      center: STRIP,
      zoom: STRIP_Z,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      minZoom: 9.5,
      maxZoom: 17,
    })
    // Leaflet paints the container background itself, so this one genuinely
    // needs a JS colour string — the sanctioned path rather than a typed hex.
    mapEl.current.style.background = t.base
    /* OSM's tile usage policy REQUIRES visible attribution. The mock hid it and
       this app inherited that — restored, styled to the palette rather than
       removed. */
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'cid-tiles',
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('zoomend moveend', () => {
      setZoom(map.getZoom())
      setTick((n) => n + 1)
    })
    mapRef.current = map
    setTick((n) => n + 1)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  /* Absorption clustering, recomputed per view: a pin inside PIN px of an
     already-placed pin joins it. This is what keeps "no two rendered pins
     overlap" true at every zoom — with real coordinates it is not optional,
     because 8 rooms sit inside 4 km of Strip. */
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()

    /* Pins and massing must share ONE camera. Leaflet places markers untilted;
       under tilt a room's pin would sit up to 213px from its own building. So in
       3D the pins are positioned through the same projector, and absorption runs
       in the space they are actually drawn in. */
    const project = makeProjector(map, on3d)
    const placed: Placed[] = []
    for (const r of roster) {
      const p = project({ lat: r.latitude, lng: r.longitude })
      const host = placed.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < PIN)
      if (host) host.members.push(r)
      else placed.push({ x: p.x, y: p.y, members: [r] })
    }

    const size = map.getSize()
    setInView(placed.reduce(
      (n, g) => n + (g.x > -40 && g.x < size.x + 40 && g.y > -40 && g.y < size.y + 40 ? g.members.length : 0),
      0,
    ))

    for (const group of placed) {
      const n = group.members.length
      const hit = group.members.filter((m) => matched.has(m.slug)).length
      const anchor = group.members[0]

      if (n > 1) {
        /* Three cluster states. The number does the work dimming cannot: at
           entry zoom the Strip is one pin, and "some of these match" is
           unreadable as a shade. */
        const state = checked.length === 0 || hit === n ? 'all' : hit === 0 ? 'none' : 'part'
        const label = state === 'all' ? String(n) : `${hit}/${n}`
        const icon = L.divIcon({
          className: '',
          html: `<div class="cid-pin cid-cluster cid-${state}" title="${
            state === 'none' ? `none of these ${n} rooms match`
              : state === 'part' ? `${hit} of ${n} rooms here match — zoom in`
              : `${n} rooms here — zoom in`
          }">${label}</div>`,
          iconSize: [CLUSTER, CLUSTER],
          iconAnchor: [CLUSTER / 2, CLUSTER / 2],
        })
        const mk = L.marker(map.containerPointToLatLng([group.x, group.y]), { icon })
        mk.on('click', () => map.setView([anchor.latitude, anchor.longitude], Math.min(16, map.getZoom() + 2)))
        mk.addTo(layer)
      } else {
        const r = anchor
        const lit = matched.has(r.slug)
        const badge = STATUS_LABEL[r.status]
        const icon = L.divIcon({
          className: '',
          html: `<div class="cid-pin cid-single${lit ? '' : ' cid-out'}${badge ? ' cid-flagged' : ''}"></div>`,
          iconSize: [SINGLE, SINGLE],
          iconAnchor: [SINGLE / 2, SINGLE / 2],
        })
        const m = L.marker(map.containerPointToLatLng([group.x, group.y]), { icon }).addTo(layer)
        m.bindPopup(popupHtml(r), { className: 'cid-popup', closeButton: false, minWidth: 240 })
      }
    }
  }, [roster, matched, checked.length, on3d, tick])

  useEffect(() => {
    const map = mapRef.current
    const cv = canvasRef.current
    const palette = paletteRef.current
    if (!map || !cv || !palette) return
    drawMassing(map, cv, roster, {
      lit: matched,
      selected: null,
      palette,
      enabled: on3d,
    })
  }, [roster, matched, on3d, tick])

  /* Two canonical destinations now, not one. Completeness is the product's
     actual claim, so the whole-valley view is a peer control, not a fallback. */
  const goStrip = useCallback(() => { mapRef.current?.setView(STRIP, STRIP_Z) }, [])
  const goValley = useCallback(() => { mapRef.current?.setView(VALLEY, VALLEY_Z) }, [])

  const toggle = (k: string) =>
    setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))

  const toggleCompare = (slug: string) =>
    setCompare((c) => (c.includes(slug) ? c.filter((x) => x !== slug) : [...c, slug]))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--cid-panel-w) minmax(0,1fr)', height: 'calc(100vh - var(--cid-header-h))' }}>
      <aside
        style={{
          background: 'var(--cid-ink-700)',
          borderRight: '1px solid var(--cid-line-2)',
          padding: 'var(--cid-space-6)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--cid-space-6)',
        }}
      >
        <div>
          <p className="num" style={{ font: 'var(--cid-num-lg)', margin: 0 }}>
            {checked.length ? `${matches.length} of ${roster.length} rooms match` : `${roster.length} rooms`}
          </p>
          {/* The landing view shows the Strip, so the roster count and the
              viewport disagree on the FIRST screen anyone sees. Saying so — with
              the control right here — beats letting the number next to it look
              broken. */}
          {inView != null && inView < roster.length && (
            <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-3) 0 0' }}>
              Showing {inView} of {roster.length} on screen —{' '}
              <button
                type="button"
                onClick={goValley}
                style={{
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  font: 'inherit', color: 'var(--cid-accent-300)',
                  borderBottom: '1px solid var(--cid-accent-line)',
                }}
              >
                see the whole valley
              </button>
            </p>
          )}
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-2) 0 0' }}>
            {checked.length
              ? 'Rooms without every checked game stay on the map, dimmed.'
              : 'Check a game to dim the rooms that lack it.'}
          </p>
        </div>

        {/* Two canonical destinations, both explicit. The valley view is where
            "every poker room in the valley" is a thing you can count, so it is a
            peer of the Strip, not a way back from it. */}
        <div style={{ display: 'flex', gap: 'var(--cid-space-3)' }}>
          <button type="button" onClick={goStrip} className="cid-viewbtn">THE STRIP</button>
          <button type="button" onClick={goValley} className="cid-viewbtn">WHOLE VALLEY</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
          <span className="cid-label">GAMES</span>
          {GAME_FILTERS.filter(([k]) => roster.some((r) => r.games.includes(k))).map(([k, label]) => {
            const n = matches.filter((r) => r.games.includes(k)).length
            const on = checked.includes(k)
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--cid-space-4)',
                  minHeight: 'var(--cid-target)', padding: '0 var(--cid-space-3)',
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  color: on ? 'var(--cid-text)' : 'var(--cid-text-3)',
                  font: on ? 'var(--cid-body-strong)' : 'var(--cid-body)',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 16, height: 16, flex: '0 0 16px',
                    border: `1px solid ${on ? 'var(--cid-accent-300)' : 'var(--cid-line-3)'}`,
                    background: on ? 'var(--cid-accent-700)' : 'transparent',
                    borderRadius: 'var(--cid-r-sm)',
                    display: 'grid', placeItems: 'center',
                    color: 'var(--cid-paper)', fontSize: 11,
                  }}
                >
                  {on ? '✓' : ''}
                </span>
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
                <button
                  type="button"
                  onClick={() => toggleCompare(slug)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--cid-dim)', cursor: 'pointer', font: 'var(--cid-tag)' }}
                >
                  REMOVE
                </button>
              </div>
            ))}
            <Link href={`/facts?compare=${compare.join(',')}`} style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-action)' }}>
              COMPARE ON JUST THE FACTS
            </Link>
          </div>
        )}
      </aside>

      <div style={{ position: 'relative' }}>
        <div ref={mapEl} className={on3d ? 'cid-3d' : ''} style={{ position: 'absolute', inset: 0 }} />
        {/* Above the tiles, below the pins: massing must never swallow the
            affordance you click. */}
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, zIndex: 401, pointerEvents: 'none' }}
        />
        <div style={{ position: 'absolute', left: 'var(--cid-space-5)', top: 'var(--cid-space-5)', zIndex: 500, display: 'flex', gap: 2, background: 'var(--cid-ink-700)', border: '1px solid var(--cid-line-2)', borderRadius: 'var(--cid-r-sm)', padding: 2 }}>
          {([['3D', true], ['FLAT', false]] as const).map(([label, v]) => (
            <button
              key={label}
              type="button"
              onClick={() => setWant3d(v)}
              style={{
                font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)',
                minHeight: 'var(--cid-target)', padding: '0 var(--cid-space-5)',
                border: 'none', borderRadius: 'var(--cid-r-sm)', cursor: 'pointer',
                background: want3d === v ? 'var(--cid-accent-700)' : 'transparent',
                color: want3d === v ? 'var(--cid-paper)' : 'var(--cid-dim)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="num"
          style={{
            position: 'absolute', right: 'var(--cid-space-5)', bottom: 'var(--cid-space-5)',
            zIndex: 500, font: 'var(--cid-tag)', color: 'var(--cid-dim)',
            background: 'var(--cid-ink-700)', border: '1px solid var(--cid-line-1)',
            borderRadius: 'var(--cid-r-sm)', padding: 'var(--cid-space-2) var(--cid-space-4)',
          }}
        >
          z{zoom} · {roster.length} ROOMS · {want3d ? (on3d ? '3D' : `3D AT z${MIN_3D_ZOOM}`) : 'FLAT'}
        </div>
      </div>
    </div>
  )
}

/** The popup carries provenance; the PIN does not. A pin marks a location,
 *  which is not a claim that can be verified or ranked. */
function popupHtml(r: MapRoom) {
  const badge = STATUS_LABEL[r.status]
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  return `
    <div class="cid-pop">
      ${badge ? `<span class="cid-pop-flag">${esc(badge)}</span>` : ''}
      <a class="cid-pop-name" href="/rooms/${esc(r.slug)}">${esc(r.name)}</a>
      <span class="cid-pop-meta">${esc(r.area.replace('_', '-'))}${
        r.table_count != null ? ` · ~${r.table_count} tables` : ''
      }</span>
      ${r.stakes ? `<span class="cid-pop-meta">~${esc(r.stakes)}</span>` : ''}
      <span class="cid-pop-ver">${r.verified_at ? `VERIFIED ${r.verified_at.slice(0, 10)}` : 'UNVERIFIED'}</span>
      <a class="cid-pop-cta" href="/rooms/${esc(r.slug)}">OPEN FULL DETAILS</a>
    </div>`
}
