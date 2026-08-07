/**
 * THE AMENITY FILTER — reopened 2026-08-07, and it needs a THIRD STATE.
 *
 * It was closed with the line: "amenity coverage is not yet complete enough for
 * a dim to be true." That was the right call and it is worth restating exactly
 * what was wrong, because the fix is not "coverage improved".
 *
 * A two-state filter says MATCH or DOESN'T. Applied to amenity data it made a
 * room with no answer look identical to a room that was asked and said no —
 * which is the one confusion this entire product exists to prevent. `room_amenities`
 * already draws the distinction: a row with `available = false` is a CONFIRMED
 * ABSENCE, a fact someone stood in the room to establish. No row at all is a
 * question nobody has asked. Collapsing those two into one dim is the same
 * error as a dash that might mean "none" or might mean "we didn't look".
 *
 * So the filter ships with three states, and the panel says all three out loud.
 * Coverage is what made that AFFORDABLE — at 0/17 answered the map would have
 * been entirely "not yet checked" and the control would have been theatre — but
 * the third state is what makes it HONEST, and it would have been required at
 * any coverage level.
 */

export type FilterState = 'match' | 'absent' | 'unknown'

export type AmenityGroup = 'games' | 'food_drink' | 'parking' | 'comfort' | 'services'

export type AmenityDef = {
  slug: string
  label: string
  grp: AmenityGroup
  sort: number
}

export const GROUP_LABEL: Record<AmenityGroup, string> = {
  games: 'GAMES',
  food_drink: 'FOOD & DRINK',
  parking: 'PARKING',
  comfort: 'COMFORT',
  services: 'SERVICES',
}

/** Panel order. Fixed rather than derived so the layout does not reshuffle as
 *  coverage changes — a control that moves between visits is a control people
 *  stop trusting. */
const GROUP_ORDER: readonly AmenityGroup[] = [
  'games', 'food_drink', 'parking', 'comfort', 'services',
]

/**
 * A slug ships once it is ANSWERED for this many rooms — yes or no, either is
 * an answer. 13 of 17 today, which ships exactly `freeself` (13) and
 * `tableside` (15) and holds back `validated` (2), `freevalet` (0) and every
 * comfort and services slug (≤1).
 *
 * AN ABSOLUTE COUNT, NOT A RATIO, and the difference is not cosmetic. As a
 * fraction of the roster, a slug could be promoted by rooms LEAVING — close two
 * unanswered rooms and `validated` climbs toward the bar without anyone having
 * answered anything. A count can only be raised by someone doing the work.
 */
export const AMENITY_SHIP_FLOOR = 13

/** slug -> answer. A missing key is "not asked", which is NOT the same as false. */
export type Answers = Readonly<Record<string, boolean>>

type HasAmenities = { amenities: Answers }

/** How many rooms have an answer either way for this slug. */
export function answeredFor(rooms: readonly HasAmenities[], slug: string): number {
  return rooms.filter((r) => r.amenities[slug] !== undefined).length
}

/**
 * The slugs with enough answers to be worth a checkbox, given the CURRENT
 * roster — same derivation the matcher uses, so the panel and the filtering can
 * never disagree about which controls exist. (The game filter learned this the
 * hard way: a gate enforced at the call site is a gate the next call site
 * forgets.)
 */
export function shippableAmenities(
  rooms: readonly HasAmenities[],
  defs: readonly AmenityDef[],
): AmenityDef[] {
  return defs.filter((d) => answeredFor(rooms, d.slug) >= AMENITY_SHIP_FLOOR)
}

/**
 * Groups to render, each with its shipped slugs.
 *
 * A GROUP HEADER WITH NO CHECKBOXES UNDER IT is a promise the data cannot keep
 * — it tells a reader that COMFORT is a thing they can filter on and then
 * offers nothing. So a group appears only when it has at least one shipped
 * slug, which today means PARKING and FOOD & DRINK, one checkbox each.
 */
export function amenityGroups(
  rooms: readonly HasAmenities[],
  defs: readonly AmenityDef[],
): Array<{ grp: AmenityGroup; label: string; items: AmenityDef[] }> {
  const ship = shippableAmenities(rooms, defs)
  return GROUP_ORDER
    .map((grp) => ({
      grp,
      label: GROUP_LABEL[grp],
      items: ship.filter((d) => d.grp === grp).sort((a, b) => a.sort - b.sort),
    }))
    .filter((g) => g.items.length > 0)
}

/**
 * One room against the checked amenity slugs.
 *
 * PRECEDENCE IS ABSENT > UNKNOWN > MATCH, and the order is the whole design:
 *
 *   - a confirmed NO on any checked slug settles it. The room does not have
 *     what was asked for, and no amount of unanswered elsewhere changes that.
 *   - otherwise an unanswered slug makes the room UNKNOWN, even if every other
 *     checked slug is a confirmed yes. "Three of the four things you asked for,
 *     and we never checked the fourth" is not a match.
 *   - MATCH requires every checked slug to be a confirmed yes.
 *
 * Reversing the last two would be the tempting bug: treating a partially
 * answered room as a match because most of it looks right. That is how a
 * filtered list starts containing rooms that fail the filter.
 */
export function amenityState(answers: Answers, checked: readonly string[]): FilterState {
  if (checked.length === 0) return 'match'
  let unknown = false
  for (const slug of checked) {
    const a = answers[slug]
    if (a === false) return 'absent'
    if (a === undefined) unknown = true
  }
  return unknown ? 'unknown' : 'match'
}

/**
 * Fold several filters into one verdict, same precedence.
 *
 * The game filter is two-state by nature — every room's game list is complete,
 * so "not spread" is a confirmed absence rather than a gap — and it enters here
 * as `match` or `absent`. Keeping the fold in one function is what stops the
 * two filters from growing different precedence rules.
 */
export function combineStates(...states: readonly FilterState[]): FilterState {
  if (states.includes('absent')) return 'absent'
  if (states.includes('unknown')) return 'unknown'
  return 'match'
}

export type Tally = { match: number; absent: number; unknown: number }

export function tally(states: readonly FilterState[]): Tally {
  return {
    match: states.filter((s) => s === 'match').length,
    absent: states.filter((s) => s === 'absent').length,
    unknown: states.filter((s) => s === 'unknown').length,
  }
}

/**
 * What the panel says. "7 match · 6 don't · 4 not yet checked".
 *
 * The third clause is dropped when it is zero — an honest report of nothing is
 * still noise — but it is never folded into either of the others, which is the
 * only rule that matters here. A count of 13 "matching" that quietly includes
 * four rooms nobody asked is the failure this whole state exists to prevent.
 */
export function summaryLine(t: Tally): string {
  const parts = [`${t.match} match`, `${t.absent} don't`]
  if (t.unknown > 0) parts.push(`${t.unknown} not yet checked`)
  return parts.join(' · ')
}
