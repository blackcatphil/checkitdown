'use client'

import { useEffect, useRef } from 'react'

import type { ClientEvent, EventName } from '@/lib/analytics-events'
import { track } from '@/lib/analytics'

/**
 * THE THREE WAYS AN EVENT IS ALLOWED TO FIRE.
 *
 * All three are client components, and that is the whole design rather than an
 * implementation detail. `/rooms/[slug]` is ISR with `revalidate = 300`: one
 * server render is handed to everybody who arrives in the next five minutes.
 * Anything counted during that render counts BUILDS — and would look like a
 * working metric the entire time, because the number would go up.
 *
 * So nothing here can be called from a server component. The seam is the
 * `'use client'` at the top of this file.
 */

/**
 * ⚠️ ONCE PER MOUNT, GUARDED BY A REF.
 *
 * React runs effects twice in development Strict Mode, and a naive
 * `useEffect(() => track(...), [])` therefore double-counts every view on
 * every developer's machine — which is the version of this bug that ships,
 * because it looks correct in production and nobody profiles their own dev
 * traffic. The ref survives the second invocation; the empty dependency array
 * alone does not.
 */
export function TrackView({
  event, roomSlug, props,
}: { event: EventName; roomSlug?: string | null; props?: ClientEvent['props'] }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    track(event, { roomSlug, props })
  }, [event, roomSlug, props])
  return null
}

/**
 * An anchor that leaves for a room's own document.
 *
 * NOT `onClick` + `preventDefault` + a manual navigation. The click must
 * navigate exactly as it would without us — middle-click, cmd-click and "open
 * in new tab" all still work — so this only fires the event and lets the
 * browser do what it was going to do. `sendBeacon` in the client helper is what
 * makes that safe: the request survives the page going away.
 */
export function OutboundLink({
  href, roomSlug, kind, children, ...rest
}: {
  href: string
  roomSlug?: string | null
  /** Which of the room's documents this is — the props are how a count is read
   *  later without a second event name per destination. */
  kind: string
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      href={href}
      onClick={() => track('outbound_room_click', { roomSlug, props: { kind } })}
      {...rest}
    >
      {children}
    </a>
  )
}

/**
 * A link to the SOURCE behind a figure — someone checking our work.
 *
 * Deliberately a separate component from `OutboundLink` rather than a prop on
 * it. Two components cannot be merged by accident; a boolean prop defaulting to
 * one of them can, and the failure would be silent — the counts would simply
 * add up wrong. See the note on `source_link_click`.
 */
export function SourceLink({
  href, roomSlug, hostIsRoom, children, ...rest
}: {
  href: string
  roomSlug?: string | null
  /** True when the citation happens to point at the room's own site. The same
   *  URL can be a receipt and a door; what separates them is which control the
   *  reader used. */
  hostIsRoom: boolean
  children: React.ReactNode
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      href={href}
      onClick={() => track('source_link_click', { roomSlug, props: { host_is_room: hostIsRoom } })}
      {...rest}
    >
      {children}
    </a>
  )
}

/** Fires on the click that opens a tournament row, and otherwise behaves like
 *  the element it wraps. */
export function TrackedClick({
  event, roomSlug, props, children,
}: {
  event: EventName
  roomSlug?: string | null
  props?: ClientEvent['props']
  children: React.ReactNode
}) {
  return (
    <span
      style={{ display: 'contents' }}
      onClick={() => track(event, { roomSlug, props })}
    >
      {children}
    </span>
  )
}
