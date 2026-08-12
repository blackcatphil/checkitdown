/**
 * THE SIX EVENT NAMES, SHARED BY THE CLIENT AND THE HANDLER.
 *
 * No secrets in this file — it is imported by browser code. The service key and
 * the writing live in `lib/analytics-server.ts`, which is server-only.
 *
 * ⚠️ SIX, NOT SEVEN. `share_link_copy` was specified conditionally — only if a
 * share affordance exists — and none does: no `navigator.clipboard`, no
 * `navigator.share`, no copy-link control anywhere in `app/`. An event with no
 * producer is a column that is permanently zero, and a permanent zero reads as
 * "nobody does this" rather than "we never asked".
 *
 * ⚠️ AND NONE OF THESE MAY FIRE FROM A RENDER. `/rooms/[slug]` is ISR with
 * `revalidate = 300`: the HTML a reader receives may have been generated
 * minutes ago for somebody else, and one build can serve a thousand people. A
 * count incremented during rendering would be counting BUILDS, not readers, and
 * would look like a working metric the whole time. Every one of these is fired
 * from a browser, from an interaction or a mount effect, never from a server
 * component.
 */

export const EVENT_NAMES = [
  /** A room's facts grid became visible to a person. Fired on mount in the
   *  browser, NOT during the cached render that produced the HTML. */
  'room_facts_view',
  /** A filter was applied on the map. The props carry which. */
  'map_filter_apply',
  /** A tournament row was opened from /tournaments. */
  'tournament_row_open',
  /** ⚠️ A READER LEFT FOR THE ROOM'S OWN PROPERTY — its site, its directions,
   *  its phone, its menu, its structure PDF. NOT the receipt link. */
  'outbound_room_click',
  /** ⚠️ A READER OPENED THE SOURCE BEHIND A FIGURE — someone checking our
   *  work, which is a different act from wanting to go to the room.
   *
   *  THEY WERE ONE EVENT UNTIL 2026-08-11 AND MERGING THEM WAS WRONG. Outbound
   *  demand is the number a room would be right to challenge — "how many people
   *  did you send us" — and padding it with people auditing our citations
   *  inflates exactly the figure that has to survive that conversation. They
   *  also move in opposite directions for opposite reasons: receipts get
   *  clicked more when a figure looks WRONG.
   *
   *  `host_is_room` in the props because a source is sometimes the room's own
   *  site: the same URL can be both a receipt and a door, and which one it was
   *  depends on what the reader clicked, not on where it points. */
  'source_link_click',
  /** A correction was submitted. Fired after the insert succeeds, so a failed
   *  submission is not counted as a report. */
  'fact_report_submit',
  /** The browser's install prompt was accepted. Fired from `userChoice`, not
   *  from the button click — a click that was then dismissed is not an
   *  install. */
  'install_accept',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

export const isEventName = (v: unknown): v is EventName =>
  typeof v === 'string' && (EVENT_NAMES as readonly string[]).includes(v)

/** What a client may send. `occurred_at` is NOT accepted — the server stamps
 *  it, so a wrong or hostile client clock cannot rewrite history. */
export type ClientEvent = {
  event_name: EventName
  /** A room slug, resolved to an id server-side. The client never sends a uuid
   *  it could have guessed or scraped. */
  room_slug?: string | null
  props?: Record<string, string | number | boolean | null>
}

/** The most a single request may carry. A batch is a convenience for a page
 *  that fires two events at once, not a bulk-import endpoint. */
export const MAX_BATCH = 20

/** Per session, per window. Generous for a person, useless for a loop. */
export const RATE_LIMIT = { events: 120, windowMs: 60_000 }
