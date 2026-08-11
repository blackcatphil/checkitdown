/**
 * FILTERING /tournaments — which events a reader is asking to see.
 *
 * 65 rows today and far more with three rooms in. Date grouping answers "what
 * is on today" and nothing else: it cannot answer "what mixed games run this
 * week", "what can I play for under $150", or — once there is more than one
 * room — "what does this room run".
 *
 * ═══ THE RULE THIS PAGE INHERITS FROM THE MAP ═══
 *
 * The map's collapsed-filter trap: a group whose boxes were still checked
 * filtered the map INVISIBLY — a dimmed city and no stated reason. The same
 * failure here is worse, because a filtered table does not look filtered. It
 * looks like a shorter schedule.
 *
 * So an active filter is never silent. The page states what is being filtered,
 * how many events that hides, and offers to clear it — and `hidden` below is
 * computed rather than inferred, so the sentence cannot drift from the table.
 *
 * ═══ EVERY DIMENSION IS A LIST ═══
 *
 * `?game=mixed,stud` rather than one value per dimension. It matches
 * `/facts?compare=a,b`, which is the idiom this codebase already uses, and the
 * useful questions are plural: mixed games, or the two cheap bands, or the
 * weekend. An empty list means "no constraint", never "match nothing" — a
 * filter that silently empties the page is the failure mode this file's whole
 * banner exists to prevent.
 */

export type FilterKey = 'room' | 'game' | 'entry' | 'day'

export const FILTER_KEYS: readonly FilterKey[] = ['room', 'game', 'entry', 'day']

/**
 * ENTRY BANDS. Edges chosen to split the population that actually exists
 * rather than to look tidy: Wynn runs 160–600+, Caesars 100–160, Orleans
 * 120–240, so most of the schedule lands under $250 and a naive
 * "under 200 / 200–400 / 400+" would put nearly every cheap daily in one bucket.
 *
 * ⚠️ THESE BAND THE **ENTRY**, NOT THE COST. `total_buy_in` is what it costs to
 * sit down; rebuys and add-ons are separate and deliberately unsummed (migration
 * 014). A band labelled "under $150" is a claim about the entry and the label
 * says so, because a reader filtering on price is exactly the reader most likely
 * to read it as the total.
 */
export const ENTRY_BANDS = [
  { id: 'u150', label: 'UNDER $150', min: 0, max: 149.99 },
  { id: '150-249', label: '$150–$249', min: 150, max: 249.99 },
  { id: '250-499', label: '$250–$499', min: 250, max: 499.99 },
  { id: '500up', label: '$500 AND UP', min: 500, max: Infinity },
] as const

export const GAME_LABELS: Record<string, string> = {
  nlh: "NO-LIMIT HOLD'EM",
  plo: 'POT-LIMIT OMAHA',
  plo5: '5-CARD PLO',
  lhe: "LIMIT HOLD'EM",
  mixed: 'MIXED',
  stud: 'STUD',
  other: 'OTHER',
}

export const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** The parsed query, with every unknown value dropped rather than carried. */
export type Filters = Record<FilterKey, string[]>

export const EMPTY_FILTERS: Filters = { room: [], game: [], entry: [], day: [] }

/**
 * Read the query string into lists.
 *
 * UNKNOWN VALUES ARE DROPPED, NOT MATCHED. `?game=roulette` filters on nothing
 * and the page shows everything, which is the safe direction: the alternative
 * is an empty table with a chip nobody can read explaining why. `?day=9` is the
 * same case — the day filter would otherwise silently match no row and look
 * like a room with no events.
 */
export function parseFilters(
  query: Partial<Record<FilterKey, string | string[] | undefined>>,
  known: { rooms: string[]; games: string[] },
): Filters {
  const list = (v: string | string[] | undefined): string[] =>
    (Array.isArray(v) ? v.join(',') : v ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)

  const uniq = (xs: string[]) => [...new Set(xs)]
  return {
    room: uniq(list(query.room)).filter((r) => known.rooms.includes(r)),
    game: uniq(list(query.game)).filter((g) => known.games.includes(g)),
    entry: uniq(list(query.entry)).filter((e) => ENTRY_BANDS.some((b) => b.id === e)),
    day: uniq(list(query.day)).filter((d) => /^[0-6]$/.test(d)),
  }
}

export const isFiltered = (f: Filters): boolean =>
  FILTER_KEYS.some((k) => f[k].length > 0)

/** The query string for a filter set, with empty dimensions omitted. */
export function filterQuery(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  for (const k of FILTER_KEYS) if (f[k].length) p.set(k, f[k].join(','))
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** The same filters with one value toggled — what a chip links to. */
export function toggle(f: Filters, key: FilterKey, value: string): Filters {
  const has = f[key].includes(value)
  return { ...f, [key]: has ? f[key].filter((v) => v !== value) : [...f[key], value] }
}

/** Which entry band a figure falls in, or null when there is no figure. */
export function bandOf(entry: number | string | null | undefined): string | null {
  if (entry == null || entry === '') return null
  const n = Number(entry)
  if (Number.isNaN(n)) return null
  return ENTRY_BANDS.find((b) => n >= b.min && n <= b.max)?.id ?? null
}

/** What a row has to expose to be filterable. */
export type Filterable = {
  roomSlug: string
  game: string | null
  entry: number | string | null
  /** Weekdays this row runs on: one for a dated instance, several for a daily. */
  days: number[]
}

/**
 * ⚠️ A ROW WITH NOTHING TO MATCH ON IS KEPT, NOT DROPPED.
 *
 * An event with no `game` recorded is not "not a mixed game" — it is an event
 * we have not classified, and hiding it behind a game filter would report a gap
 * in our data as a fact about the schedule. Same for a missing entry figure.
 * The dimension simply does not constrain a row that cannot answer it, which is
 * the same ruling `/facts` applies when it sorts unverified rows below the
 * ranking instead of pretending they failed it.
 */
export function matches(row: Filterable, f: Filters): boolean {
  if (f.room.length && !f.room.includes(row.roomSlug)) return false
  if (f.game.length && row.game != null && !f.game.includes(row.game)) return false
  if (f.entry.length) {
    const b = bandOf(row.entry)
    if (b != null && !f.entry.includes(b)) return false
  }
  if (f.day.length && row.days.length && !row.days.some((d) => f.day.includes(String(d)))) return false
  return true
}

/** A sentence naming what is filtered, for the banner. Never a bare count. */
export function describe(f: Filters, roomName: (slug: string) => string): string {
  const parts: string[] = []
  if (f.room.length) parts.push(f.room.map(roomName).join(' or '))
  if (f.game.length) parts.push(f.game.map((g) => GAME_LABELS[g] ?? g.toUpperCase()).join(' or '))
  if (f.entry.length) {
    parts.push(f.entry.map((e) => ENTRY_BANDS.find((b) => b.id === e)?.label ?? e).join(' or '))
  }
  if (f.day.length) parts.push(f.day.map((d) => DAY_LABELS[Number(d)]).join(' or '))
  return parts.join(' · ')
}
