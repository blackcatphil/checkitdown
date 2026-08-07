/**
 * SURFACES ARE GATED ON COVERAGE, DATA IS NOT.
 *
 * Three fields are 0/17 and researched to stay that way: no room on the sheet
 * publishes house rules, and the one first-party dress code that exists
 * (Venetian) is the CASINO FLOOR's policy, not the poker room's. A column of
 * seventeen dashes is not a fact about seventeen rooms — it is a fact about us,
 * and it teaches a reader that our dashes mean nothing.
 *
 * So the surface goes and the columns stay. Same mechanism the amenity filter
 * was ruled on: the data keeps accruing, the floor-visit checklist still
 * collects it, and one filled room brings the surface back.
 *
 * THE THRESHOLD IS ONE ROOM, and that is the point rather than a convenience.
 * A surface hidden behind a hardcoded `false` is a surface nobody remembers
 * exists; the first floor visit that records a dress code would fill a column
 * that renders nowhere, and the omission would have to be REDISCOVERED. At a
 * threshold of one, that visit makes the surface reappear on its own, and the
 * maintainer is confronted with a live decision — "is one room enough to show
 * this?" — instead of a silence.
 *
 * If one room ever turns out NOT to be enough, raise this number and say why.
 * Do not reach for a boolean.
 */
export const COVERAGE_FLOOR = 1

/** How many rows carry a usable value — null and empty string both count as absent. */
export function coverageOf<T>(rows: readonly T[], get: (row: T) => unknown): number {
  return rows.filter((r) => {
    const v = get(r)
    return v != null && v !== ''
  }).length
}

export function isCovered<T>(rows: readonly T[], get: (row: T) => unknown): boolean {
  return coverageOf(rows, get) >= COVERAGE_FLOOR
}

/** Which optional surfaces have earned their place on the page. */
export type Coverage = {
  dressCode: boolean
  drinks: boolean
  houseRules: boolean
}

/**
 * Computed across the WHOLE ROSTER, not the room being viewed. A single room's
 * blank dress code says nothing about whether the field is worth a tile; the
 * question is whether ANY room has one. Reading it per-room would hide the tile
 * on sixteen pages and show it on the seventeenth, which is worse than either.
 */
export function coverageFrom(
  rooms: readonly { dress_code: string | null; drinks_note: string | null }[],
  houseRuleCount: number,
): Coverage {
  return {
    dressCode: isCovered(rooms, (r) => r.dress_code),
    drinks: isCovered(rooms, (r) => r.drinks_note),
    houseRules: houseRuleCount >= COVERAGE_FLOOR,
  }
}
