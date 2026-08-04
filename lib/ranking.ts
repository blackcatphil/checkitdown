/**
 * Ranking and exclusion rules, in one place because they are the rules that
 * cost the most when broken and every surface has to apply them identically.
 *
 * The state these exist for is MIXED — a handful of verified rooms among many
 * unverified ones. That is not an edge case, it is what launch day and the
 * months after it look like.
 */

export type RoomFacts = {
  slug: string
  name: string
  /** value being ranked; null means the room publishes no figure at all */
  value: number | null
  /** has a human confirmed THIS fact on site */
  verified: boolean
}

export type Ranked = RoomFacts & {
  /** citywide position, or null when the room cannot be ranked */
  rank: number | null
  /** true only for rank 1 — teal marks best-in-city, never "best of your picks" */
  isLeader: boolean
}

export type Exclusion = {
  /** rooms held out because nobody has stood in them */
  unverified: string[]
  /** rooms held out because no source publishes the figure at all */
  unpublished: string[]
}

/**
 * If you can name them in one line, name them; past that, state the count and
 * the reason.
 *
 * "1 room skipped" is a hedge — it hides WHICH room and denies the reader the
 * chance to correct it. But when exclusions are the norm rather than the
 * exception there is nothing hidden: the reason is uniform and a list of
 * fourteen names gives a reader nothing to act on.
 */
export const ENUMERATE_MAX = 3

/**
 * A sort, defined once so the claim and the comparator cannot drift apart.
 *
 * This is the guard for two rules that were prose-only and had already been
 * broken once each — the freshness column shipped sorting on array position
 * while labelling itself "# BY FRESHNESS":
 *
 *   1. "Any column offered as a sort must have a number behind it."
 *      `value` is typed `number | null`. A string-valued sort is a compile
 *      error, not a review catch.
 *   2. "A sort's direction is part of the claim."
 *      The caption is DERIVED from `direction` below, so a caption describing a
 *      superseded formula cannot survive a change to the comparator.
 */
export type SortSpec = {
  /** re-qualifies the rank column: "# BY RAKE" */
  key: string
  /** the metric actually ranked on, in words */
  metric: string
  direction: 'asc' | 'desc'
}

export function sortHead(spec: SortSpec): string {
  return `# BY ${spec.key.toUpperCase()}`
}

/** Names which end is best AND the metric it ranks on — both from one source. */
export function sortCaption(spec: SortSpec): string {
  return `${spec.metric}, ${spec.direction === 'asc' ? 'lowest first' : 'highest first'}.`
}

/** Rank and caption from the same spec, so they cannot disagree. */
export function applySort(rooms: RoomFacts[], spec: SortSpec) {
  return {
    ranked: rank(rooms, spec.direction),
    head: sortHead(spec),
    caption: sortCaption(spec),
  }
}

/**
 * Ascending = lower is better (rake). Descending = higher is better (tables).
 * Prefer `applySort` — calling this directly reopens the caption/comparator gap.
 */
export function rank(rooms: RoomFacts[], direction: 'asc' | 'desc'): Ranked[] {
  const eligible = rooms.filter((r) => r.verified && r.value != null)
  const ordered = [...eligible].sort((a, b) =>
    direction === 'asc' ? a.value! - b.value! : b.value! - a.value!,
  )

  const rankBySlug = new Map<string, number>()
  ordered.forEach((r, i) => {
    // Ties share a position, and the next distinct value skips accordingly.
    const prev = ordered[i - 1]
    rankBySlug.set(r.slug, prev && prev.value === r.value ? rankBySlug.get(prev.slug)! : i + 1)
  })

  /* Ranked rooms first in rank order, then everything else alphabetically.
     An unranked row never sorts into the middle of the ranking and never
     borrows a neighbour's position. */
  const rest = rooms
    .filter((r) => !rankBySlug.has(r.slug))
    .sort((a, b) => a.name.localeCompare(b.name))

  return [
    ...ordered.map((r) => ({
      ...r,
      rank: rankBySlug.get(r.slug)!,
      isLeader: rankBySlug.get(r.slug) === 1,
    })),
    ...rest.map((r) => ({ ...r, rank: null, isLeader: false })),
  ]
}

export function exclusions(rooms: RoomFacts[]): Exclusion {
  return {
    unverified: rooms.filter((r) => !r.verified).map((r) => r.name),
    unpublished: rooms.filter((r) => r.verified && r.value == null).map((r) => r.name),
  }
}

function phrase(names: string[], one: string, many: string): string | null {
  if (names.length === 0) return null
  if (names.length <= ENUMERATE_MAX) {
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return `${list} ${names.length === 1 ? one : many}`
  }
  return `${names.length} rooms ${many}`
}

/** The line under a ranked column. Names what is missing and why, never a bare count. */
export function exclusionLine(ex: Exclusion, metric: string): string | null {
  const parts = [
    phrase(ex.unverified, 'is not confirmed on site yet', 'are not confirmed on site yet'),
    phrase(
      ex.unpublished,
      `is confirmed but publishes no ${metric}`,
      `are confirmed but publish no ${metric}`,
    ),
  ].filter(Boolean) as string[]

  if (!parts.length) return null
  return `${parts.join('; ')} — excluded from this ranking, not from the table.`
}
