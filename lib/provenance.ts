/**
 * WHAT THE PROVENANCE BLOCK IS ALLOWED TO SAY.
 *
 * It said one thing, always: *"Every figure on this page is sourced and none is
 * verified."* That was true the day it was written and false by the time anyone
 * noticed — the number-copied-forward class, in prose. Production holds 6
 * game-verified and 33 rake-verified rows, so on Wynn the page carried four
 * in-person rake receipts and a sentence directly above them denying any of it.
 *
 * The bug underneath was narrower than "the copy is stale": the block gated on
 * `rooms.verified_at`, which is NULL for all seventeen rooms, while the FACTS
 * are verified one row at a time on `cash_games.verified_at` and
 * `cash_games.rake_verified_at`. A room-level flag cannot describe a page whose
 * verification is per-fact, and it fails in the worst direction — it under-
 * reports, so the site looks less trustworthy than its own data.
 *
 * So the state is COMPUTED, off the same columns the rankings gate on, and the
 * block explains the REMAINDER rather than the page. Once nothing is left
 * unverified it has nothing to explain and does not render.
 *
 * NO ROOM IS NAMED ANYWHERE IN HERE. A hardcoded list of verified rooms is the
 * same failure one layer down: correct on the day it is written, silently wrong
 * after the next floor visit, and invisible to every test that does not know to
 * look for it.
 */

/** One displayed fact and its receipt. `sourceUrl` may be null — some facts are
 *  rendered without one, and pretending otherwise would invent a citation. */
export type Fact = {
  /** what kind of fact — carried for tests and for reading a failure */
  kind: string
  verified: boolean
  sourceUrl: string | null
}

export type ProvenanceState = 'none' | 'some' | 'all'

/**
 * ALL means "nothing is left to explain", which is why the empty list lands
 * there rather than in `none`. A page with no facts has no unverified remainder,
 * and a block reading "nothing here is confirmed" above an empty page would be
 * technically true and completely useless.
 */
export function provenanceState(facts: readonly Fact[]): ProvenanceState {
  const unverified = facts.filter((f) => !f.verified)
  if (unverified.length === 0) return 'all'
  return unverified.length === facts.length ? 'none' : 'some'
}

/**
 * The copy, keyed by state, so the sentence and the condition cannot drift.
 *
 * `some` deliberately opens with "Everything else": it is a statement about the
 * remainder and only makes sense under the verified receipts, which is why the
 * block moved below them. Read above them it contradicts the page.
 */
export const PROVENANCE_COPY: Record<Exclude<ProvenanceState, 'all'>, string> = {
  none: 'Nothing here is confirmed in person yet. These come from published sources and stay out of the rankings.',
  some: 'Everything else comes from published sources and stays out of the rankings.',
}

/**
 * THE SENTENCE MUST NEVER SAY "NOTHING IS VERIFIED" ON A ROOM THAT HOLDS ONE.
 *
 * Stated as a predicate rather than left to the reader of the record above,
 * because this is the exact regression that shipped: a true sentence, a changing
 * database, and nothing connecting them. `test:mixed` asserts it against the
 * rendered HTML, and this is the same claim in one place the unit tests can also
 * reach.
 */
export function claimsNothingVerified(state: ProvenanceState): boolean {
  return state === 'none'
}

export type CitedSource = {
  url: string
  /** the host a reader recognises, or null when the URL will not parse */
  host: string | null
  /** a source that must be named but never linked — see `lib/receipts.ts` */
  isPrivate: boolean
}

/**
 * Distinct sources behind the UNVERIFIED facts, in first-appearance order.
 *
 * Scoped to the unverified remainder on purpose. A verified fact's receipt is
 * the floor visit, stated above; repeating its URL down here would offer a
 * reader a published page as the evidence for something a person confirmed —
 * weaker evidence, presented as the reason.
 *
 * Deduped by URL, because two games read off one page are one source and a list
 * that repeats it reads like corroboration that does not exist.
 */
export function unverifiedSources(
  facts: readonly Fact[],
  isPrivateUrl: (url: string) => boolean,
  hostOf: (url: string) => string | null,
): CitedSource[] {
  const seen = new Set<string>()
  const out: CitedSource[] = []
  for (const f of facts) {
    if (f.verified || !f.sourceUrl || seen.has(f.sourceUrl)) continue
    seen.add(f.sourceUrl)
    out.push({ url: f.sourceUrl, host: hostOf(f.sourceUrl), isPrivate: isPrivateUrl(f.sourceUrl) })
  }
  return out
}
