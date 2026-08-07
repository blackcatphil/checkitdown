/**
 * HOW THE REVIEW QUEUE IS ORDERED — the product decision, kept out of the page
 * so it can be tested without a browser or a database.
 *
 * Precedence is by RECENCY OF HUMAN CHECK, not by source class. A scrape that
 * disagrees with a person-verified fact is usually the scraper being wrong —
 * unless it was taken AFTER the person looked, in which case it is the room
 * having changed, which is the entire reason this product exists. Those rise;
 * everything else sorts by confidence, then oldest first.
 */

export type QueueRow = {
  fetched_at: string
  fact_verified_at: string | null
  confidence: number | null
  created_at: string
}

/** A proposal dated after the floor visit it contradicts. */
export function isStaleVerification(fetchedAt: string, verifiedAt: string | null): boolean {
  return verifiedAt != null && new Date(fetchedAt) > new Date(verifiedAt)
}

export function orderQueue<T extends QueueRow>(rows: T[]): T[] {
  /* Copied, not sorted in place: this receives an array that a component also
     renders, and mutating a prop is a rendering bug waiting to happen. */
  return [...rows].sort((a, b) => {
    const aStale = isStaleVerification(a.fetched_at, a.fact_verified_at)
    const bStale = isStaleVerification(b.fetched_at, b.fact_verified_at)
    if (aStale !== bStale) return aStale ? -1 : 1
    const c = (b.confidence ?? 0) - (a.confidence ?? 0)
    if (c !== 0) return c
    return new Date(a.created_at).valueOf() - new Date(b.created_at).valueOf()
  })
}
