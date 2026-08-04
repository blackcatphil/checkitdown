'use client'

import dynamic from 'next/dynamic'

import type { MapRoom } from './MapShell'

/**
 * Leaflet reads `window` at module scope, so it cannot be prerendered. Loading
 * it ssr:false keeps the rest of the page static — and the map is the one
 * surface where a server-rendered first paint buys nothing, because tiles and
 * projection are client work regardless.
 */
const MapShell = dynamic(() => import('./MapShell').then((m) => m.MapShell), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 'calc(100vh - var(--cid-header-h))',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--cid-dim)',
        font: 'var(--cid-tag)',
        letterSpacing: 'var(--cid-track-nav)',
      }}
    >
      LOADING MAP
    </div>
  ),
})

export function MapClient({ rooms }: { rooms: MapRoom[] }) {
  return <MapShell rooms={rooms} />
}
