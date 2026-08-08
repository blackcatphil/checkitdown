/**
 * ROSTER AND ELIGIBILITY — the read-path half of the schema's state columns.
 *
 * The schema encodes more states than a naive read interrogates. `available`
 * proved that: it sat as `boolean not null` for days, harmless only because the
 * seed never wrote `false`. These columns are the same shape — dormant while
 * the seed writes one value, live the day real data arrives — so the rules live
 * in one place and every surface applies them identically.
 *
 * Any state column NOT filtered here is listed at the bottom with the reason.
 */

export type RoomStatus = 'open' | 'temporarily_closed' | 'closed' | 'seasonal'

export type RosterRoom = {
  status: RoomStatus
  is_seasonal: boolean
  season_start?: string | null
  season_end?: string | null
}

/**
 * On the default roster?
 *
 * - `closed` is gone, not hidden: it is no longer a poker room, and the roster
 *   is "rooms you can play in". Planet Hollywood and Resorts World simply are
 *   not rows.
 * - `is_seasonal` / `seasonal` is OFF the roster, the pin set and every count by
 *   default — a locked product decision that until now existed only in prose.
 *   NO SEASONAL ROW EXISTS. WSOP·Paris was never seeded, and the 2026-08-07
 *   ruling keeps it out of the roster for good: it gets a dedicated page when
 *   the series runs, not a row behind a flag. This branch is therefore a
 *   guarantee about a future room rather than a description of a current one,
 *   and it is kept for exactly that reason — `test:mixed` proves it, so a
 *   series room arriving later cannot silently vanish from the roster.
 * - `temporarily_closed` STAYS on the roster. It is a real room with a real
 *   reason to look it up, and hiding it reads as "we don't have it". It is
 *   shown and flagged — but see `isRankable`.
 */
export function inRoster(r: RosterRoom): boolean {
  return r.status !== 'closed' && r.status !== 'seasonal' && !r.is_seasonal
}

/**
 * Eligible to hold a rank?
 *
 * Only `open`. A temporarily closed room cannot be the city's best anything
 * today — you cannot go and play there — so it appears in the table and is
 * excluded from the ranking with its reason named, exactly like an unverified
 * room. Ranking a room you cannot enter is a claim the world falsifies.
 */
export function isRankable(r: RosterRoom): boolean {
  return inRoster(r) && r.status === 'open'
}

export const STATUS_LABEL: Record<RoomStatus, string | null> = {
  open: null,
  temporarily_closed: 'TEMPORARILY CLOSED',
  closed: 'CLOSED',
  seasonal: 'SERIES ONLY',
}

/** Is a dated thing live right now? `is_active` alone is not enough — a promo
 *  whose `ends_on` has passed is over whether or not anyone cleared the flag. */
export function isLive(
  x: { is_active?: boolean | null; starts_on?: string | null; ends_on?: string | null },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (x.is_active === false) return false
  if (x.starts_on && x.starts_on > today) return false
  if (x.ends_on && x.ends_on < today) return false
  return true
}

/**
 * DELIBERATELY UNFILTERED — display-only columns. Listed so the next sweep can
 * tell "considered and rejected" from "never looked at".
 *
 *   cash_games.is_spread_limit   distinguishes a stakes model; both render
 *   cash_games.is_uncapped       renders as "Uncapped" instead of a number
 *   cash_games.must_post         a house rule to display, not a filter
 *   rooms.is_24h                 display; hours_note carries the detail
 *   tournament_levels.is_break   part of the structure, shown in place
 *   tournament_templates.guarantee_is_estimated  drives the tilde, not a filter
 *   tournament_templates.reentry_allowed         display
 *   tournament_templates.reliability             EDITORIAL — display only, and
 *                                                never sortable or ordinalised
 * (`amenity_types.is_filterable` LEFT THIS LIST on 2026-08-07. It was here
 * waiting for the amenity groups to turn on; they have, and `app/page.tsx` now
 * applies it when loading the catalogue. A column listed as deliberately
 * unfiltered while something filters on it would be worse than no list.)
 */
export const UNFILTERED_BY_DESIGN = [
  'cash_games.is_spread_limit',
  'cash_games.is_uncapped',
  'cash_games.must_post',
  'rooms.is_24h',
  'tournament_levels.is_break',
  'tournament_templates.guarantee_is_estimated',
  'tournament_templates.reentry_allowed',
  'tournament_templates.reliability',
] as const
