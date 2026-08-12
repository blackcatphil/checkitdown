/**
 * WHAT THE LEDGER COUNTS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * ═══ THE DENOMINATOR IS THE WHOLE MEANING OF THE NUMBER ═══
 *
 * "Coverage" is a ratio, and a ratio is an argument about what should have been
 * there. Put the wrong things in the bottom half and every room looks worse for
 * a reason that has nothing to do with the room.
 *
 * EXCLUDED, MEASURED ON 2026-08-11 ACROSS ALL 17:
 *   dress_code           0/17    nobody has collected it
 *   drinks_note          0/17    same
 *   house_rules          0/17    same
 *   room_descriptions    0/17    content arrives through the queue
 *   tournaments          1/17    sixteen rooms would look incomplete for not
 *                                running tournaments, which is not a gap
 *   loyalty_program     12/17    a room may genuinely have no club; absence
 *                                here is a fact, not a hole
 *   website_url / source_url  17/17  a constant adds nothing to a ratio
 *
 * The first four would drop every room by the same amount, which is a
 * statement about our checking wearing the costume of a statement about rooms.
 *
 * ═══ ⚠️ THIS IS NOT A PERCENTAGE, AND THE SCREEN MUST NOT MAKE IT ONE ═══
 *
 * Four of the eight below are 17/17. So the ratio ranges from about 62% to 100%
 * and cannot separate a well-covered room from a poorly covered one — it can
 * only reassure. The ledger renders `n/8` AND THE NAMES OF WHAT IS MISSING,
 * because the names are the part somebody can act on.
 */

export type CoverageField = {
  key: string
  /** What the ledger prints when it is missing. Short: it appears in a list. */
  label: string
  has: (r: CoverageRoom) => boolean
}

export type CoverageRoom = {
  table_count: number | null
  phone: string | null
  min_age: number | null
  is_24h: boolean | null
  hours_note: string | null
  comp_rate_hourly: number | string | null
  cash_games: Array<{ id: string; rake_cap: unknown; rake_percent: unknown }>
  room_amenities: Array<{ amenity_id: string }>
}

/**
 * EIGHT FIELDS. Each one is something a person could go and find out, and each
 * one varies across the roster — a field every room has tells you nothing.
 */
export const COVERAGE_FIELDS: CoverageField[] = [
  { key: 'hours', label: 'hours', has: (r) => r.is_24h === true || r.hours_note != null },
  { key: 'min_age', label: 'min age', has: (r) => r.min_age != null },
  { key: 'games', label: 'cash games', has: (r) => r.cash_games.length > 0 },
  {
    key: 'rake',
    label: 'rake',
    /* A game row is not a rake. A room can list six games and publish no rake
       at all, which is the case this column exists to surface. */
    has: (r) => r.cash_games.some((g) => g.rake_cap != null || g.rake_percent != null),
  },
  { key: 'tables', label: 'table count', has: (r) => r.table_count != null },
  { key: 'amenities', label: 'amenities', has: (r) => r.room_amenities.length > 0 },
  { key: 'phone', label: 'phone', has: (r) => r.phone != null },
  { key: 'comps', label: 'comps', has: (r) => r.comp_rate_hourly != null },
]

export function coverageFor(r: CoverageRoom): { filled: number; missing: string[] } {
  const missing = COVERAGE_FIELDS.filter((f) => !f.has(r)).map((f) => f.label)
  return { filled: COVERAGE_FIELDS.length - missing.length, missing }
}

export type VerificationRoom = {
  verified_at: string | null
  cash_games: Array<{ rake_verified_at: string | null }>
  room_amenities: Array<{ verified_at: string | null }>
}

/**
 * VERIFICATION IS A COUNT AND A DATE, KEPT SEPARATE FROM FILLED.
 *
 * ⚠️ THE TWO MUST NEVER BE AVERAGED TOGETHER. Holding a figure and having stood
 * in the room and checked it are different claims, and a single blended
 * "coverage" score would let a room read as complete on figures nobody has
 * confirmed — the precedence law flattened into an average.
 *
 * Counted from the two columns that actually carry stamps:
 * `cash_games.rake_verified_at` (58/78) and `room_amenities.verified_at`
 * (30/39). `rooms.verified_at` is 0/17 and is shown by the ledger as an
 * em-dash — the honest absence, not a zero that would read as a measurement.
 */
export function verificationFor(r: VerificationRoom): { stamped: number; newest: string | null } {
  const stamps = [
    ...r.cash_games.map((g) => g.rake_verified_at),
    ...r.room_amenities.map((a) => a.verified_at),
  ].filter((s): s is string => s != null)
  return {
    stamped: stamps.length,
    newest: stamps.length === 0 ? null : stamps.slice().sort().at(-1)!,
  }
}
