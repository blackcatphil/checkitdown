/**
 * THE SHARED FIGURE FORMATTERS.
 *
 * Extracted from the room page's local helpers so that PROSE AND THE FACTS
 * GRID CANNOT DISAGREE ABOUT THE SAME NUMBER. A description interpolates from
 * the same query the grid reads (item 3 of the 2026-08-09 ruling), and reading
 * the same row while formatting it differently would satisfy the letter of that
 * and still print "10% to $8" in one place and "$8 cap" in the other.
 *
 * One row in, one string out. Nothing here decides whether a figure is
 * VERIFIED — that is the caller's job, because the marker belongs to the
 * display, not to the number.
 */

export type RakeRow = {
  rake_type: string | null
  rake_percent: number | null
  rake_cap: number | null
}

export type StakesRow = {
  stakes_label: string
  big_blind: number | null
  big_bet: number | null
}

/** The grid's rake string. NULL when the room has not stated a rake type —
 *  an absent rake is a dash in the grid and an unresolved token in prose. */
export function formatRake(g: RakeRow): string | null {
  if (g.rake_type == null) return null
  if (g.rake_percent != null && g.rake_cap != null) return `${Number(g.rake_percent)}% to $${Number(g.rake_cap)}`
  if (g.rake_cap != null) return `to $${Number(g.rake_cap)}`
  return null
}

/** The room page's own ordering: by blind, falling back to big bet for
 *  fixed-limit. Shared so "lowest stakes" means the same thing in both places. */
export function byStakes<T extends StakesRow>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => (Number(a.big_blind ?? a.big_bet ?? 0)) - (Number(b.big_blind ?? b.big_bet ?? 0)),
  )
}
