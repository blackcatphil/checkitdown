'use client'

import { MAX_BATCH, type ClientEvent, type EventName } from './analytics-events.ts'

/**
 * THE BROWSER SIDE. Fires events; knows nothing about the database.
 *
 * ⚠️ NOTHING HERE MAY BE CALLED FROM A SERVER RENDER. `/rooms/[slug]` is ISR
 * with `revalidate = 300` — one render is served to everybody who arrives in
 * the next five minutes, and a render is not a view. Counting during rendering
 * would count BUILDS while looking exactly like a working metric. Every call
 * site is an interaction handler or a mount effect, in the browser.
 */

const DEVICE_KEY = 'cid_device'
const SESSION_KEY = 'cid_session'
const INTERNAL_KEY = 'cid_internal'

/** 400 days — the longest a first-party cookie may live under current browser
 *  rules, applied here to a localStorage value for the same reason: it is the
 *  ceiling, so writing it down stops the number drifting upward later. */
export const DEVICE_TTL_DAYS = 400

/**
 * ⚠️ A RANDOM TOKEN, AND NOTHING ELSE.
 *
 * No canvas, no fonts, no screen size, no language, no timezone, no hardware
 * concurrency, no IP — nothing derived from the device at all. Which means this
 * cannot re-identify anyone across a cleared browser, cannot be correlated with
 * a token from another site, and cannot be reconstructed if it is lost. Those
 * are the properties that make it a counter rather than a tracker, and every
 * one of them comes from the same decision: the value is 128 bits of noise.
 *
 * `crypto.randomUUID` is in every browser that supports the service worker this
 * app already requires, so there is no fallback path to get wrong.
 */
function readToken(store: Storage, key: string, ttlDays?: number): string {
  try {
    const raw = store.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as { v: string; t: number }
      const expired = ttlDays != null && Date.now() - parsed.t > ttlDays * 86_400_000
      if (parsed?.v && !expired) return parsed.v
    }
  } catch { /* corrupted or storage disabled — mint a fresh one below */ }
  const v = crypto.randomUUID()
  try { store.setItem(key, JSON.stringify({ v, t: Date.now() })) } catch { /* private mode */ }
  return v
}

/** Survives the browser closing, for 400 days. */
export const deviceId = (): string => readToken(localStorage, DEVICE_KEY, DEVICE_TTL_DAYS)
/** Dies with the tab. Not extended, not refreshed — a session is a visit. */
export const sessionId = (): string => readToken(sessionStorage, SESSION_KEY)

/**
 * A QUEUE, FLUSHED ON A MICROTASK.
 *
 * Two events fired by one interaction become one request. Not a timer: a
 * flush that waits would lose the batch when the tab closes, and the whole
 * point of `sendBeacon` below is surviving that moment.
 */
let queue: ClientEvent[] = []
let scheduled = false

function flush(): void {
  if (queue.length === 0) return
  const batch = queue.slice(0, MAX_BATCH)
  queue = queue.slice(MAX_BATCH)
  scheduled = false

  let internal = false
  try { internal = localStorage.getItem(INTERNAL_KEY) === '1' } catch { /* ignore */ }

  const body = JSON.stringify({
    device_id: deviceId(),
    session_id: sessionId(),
    internal,
    events: batch,
  })

  /* `sendBeacon` first: it survives the page being navigated away from or
     closed, which is exactly when an outbound-click event fires. It cannot set
     headers, so the handler must not require any. */
  try {
    if (navigator.sendBeacon?.(
      '/api/events', new Blob([body], { type: 'application/json' }))) return
  } catch { /* fall through */ }

  /* ⚠️ `keepalive`, AND `.catch()` THAT SWALLOWS. Counting must never break the
     product: an unhandled rejection here would surface as a console error on a
     page whose data is perfectly fine. */
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

/**
 * Record one event. Safe to call anywhere in the browser; a no-op on the
 * server, so a component that is rendered both ways cannot double-count.
 */
export function track(
  event_name: EventName,
  opts: { roomSlug?: string | null; props?: ClientEvent['props'] } = {},
): void {
  if (typeof window === 'undefined') return
  queue.push({ event_name, room_slug: opts.roomSlug ?? null, props: opts.props })
  if (scheduled) return
  scheduled = true
  queueMicrotask(flush)
}

/** For the console and for tests: mark this browser as ours so its rows can be
 *  excluded from a count without being deleted. */
export const markInternal = (on = true): void => {
  try {
    if (on) localStorage.setItem(INTERNAL_KEY, '1')
    else localStorage.removeItem(INTERNAL_KEY)
  } catch { /* ignore */ }
}
