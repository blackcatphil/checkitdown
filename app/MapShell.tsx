'use client'

import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

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
 * HOME VIEW — measured against REAL coordinates, not inherited from the mock.
 * See scripts/map-fit.mjs. The valley is 26 x 29 km with 8 of 17 rooms inside
 * ~4 km of Strip, so at z11 all 17 fit the crop and absorption yields 10
 * rendered pins whose closest pair is 34.6px — no two rendered pins overlap.
 */
const HOME: [number, number] = [36.1309, -115.1709]
const HOME_Z = 11
/** Pin footprint. Two pins inside this distance collide, so one absorbs the other. */
const PIN = 32

/** The panel ships with GAMES only — see the coverage-gate decision. */
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
  const [zoom, setZoom] = useState(HOME_Z)
  const [tick, setTick] = useState(0)

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
    const map = L.map(mapEl.current, {
      center: HOME,
      zoom: HOME_Z,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      minZoom: 9.5,
      maxZoom: 17,
    })
    // Leaflet paints the container background itself, so this one genuinely
    // needs a JS colour string — the sanctioned path rather than a typed hex.
    mapEl.current.style.background = t.base
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'cid-tiles',
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

    const placed: Placed[] = []
    for (const r of roster) {
      const p = map.latLngToLayerPoint([r.latitude, r.longitude])
      const host = placed.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < PIN)
      if (host) host.members.push(r)
      else placed.push({ x: p.x, y: p.y, members: [r] })
    }

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
          iconSize: [PIN, PIN],
          iconAnchor: [PIN / 2, PIN / 2],
        })
        L.marker([anchor.latitude, anchor.longitude], { icon })
          .on('click', () => map.setView([anchor.latitude, anchor.longitude], Math.min(15, map.getZoom() + 2.5)))
          .addTo(layer)
      } else {
        const r = anchor
        const lit = matched.has(r.slug)
        const badge = STATUS_LABEL[r.status]
        const icon = L.divIcon({
          className: '',
          html: `<div class="cid-pin cid-single${lit ? '' : ' cid-out'}${badge ? ' cid-flagged' : ''}"></div>`,
          iconSize: [PIN, PIN],
          iconAnchor: [PIN / 2, PIN / 2],
        })
        const m = L.marker([r.latitude, r.longitude], { icon }).addTo(layer)
        m.bindPopup(popupHtml(r), { className: 'cid-popup', closeButton: false, minWidth: 240 })
      }
    }
  }, [roster, matched, checked.length, tick])

  const toggle = (k: string) =>
    setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))

  const inCompare = (slug: string) => compare.includes(slug)
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
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-2) 0 0' }}>
            {checked.length
              ? 'Rooms without every checked game stay on the map, dimmed.'
              : 'Check a game to dim the rooms that lack it.'}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
          <span className="cid-label">GAMES</span>
          {GAME_FILTERS.map(([k, label]) => {
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
        <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />
        <div
          className="num"
          style={{
            position: 'absolute', right: 'var(--cid-space-5)', bottom: 'var(--cid-space-5)',
            zIndex: 500, font: 'var(--cid-tag)', color: 'var(--cid-dim)',
            background: 'var(--cid-ink-700)', border: '1px solid var(--cid-line-1)',
            borderRadius: 'var(--cid-r-sm)', padding: 'var(--cid-space-2) var(--cid-space-4)',
          }}
        >
          z{zoom} · {roster.length} ROOMS · OSM
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
