/**
 * WHAT THE PROVENANCE BLOCK IS ALLOWED TO SAY.
 *
 * It said one thing, always: *"Every figure on this page is sourced and none is
 * verified."* That was true the day it was written and false by the time anyone
 * noticed — the number-copied-forward class, in prose. Production had verified
 * rows on both `cash_games.verified_at` and `cash_games.rake_verified_at` by
 * then, so on Wynn the page carried four in-person rake receipts and a sentence
 * directly above them denying any of it.
 *
 * The counts are deliberately not repeated here. This comment used to say "6
 * game-verified and 33 rake-verified rows", which went stale on the next
 * partner apply — the same failure the comment is describing, committed inside
 * the description of it. The state is computed below; read it from there.
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

/**
 * One displayed fact and its receipt.
 *
 * THE STAMP IS THE FACT, not a boolean beside one. This carried
 * `verified: boolean` and a separate date would have had to travel next to it
 * for the badge — two fields that can disagree, describing one thing. Every
 * verification column in the schema is a `timestamptz`, so nothing is lost by
 * keeping the stamp and deriving the boolean.
 *
 * `sourceUrl` may be null — some facts render without one, and inventing a
 * citation is worse than admitting there is none.
 */
export type Fact = {
  /** what kind of fact — carried for tests and for reading a failure */
  kind: string
  /** when a person confirmed it; null means nobody has */
  verifiedAt: string | null
  sourceUrl: string | null
}

export const isVerified = (f: Fact): boolean => f.verifiedAt != null

export type ProvenanceState = 'none' | 'some' | 'all'

/**
 * ALL means "nothing is left to explain", which is why the empty list lands
 * there rather than in `none`. A page with no facts has no unverified remainder,
 * and a block reading "nothing here is confirmed" above an empty page would be
 * technically true and completely useless.
 */
export function provenanceState(facts: readonly Fact[]): ProvenanceState {
  const unverified = facts.filter((f) => !isVerified(f))
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
    if (isVerified(f) || !f.sourceUrl || seen.has(f.sourceUrl)) continue
    seen.add(f.sourceUrl)
    out.push({ url: f.sourceUrl, host: hostOf(f.sourceUrl), isPrivate: isPrivateUrl(f.sourceUrl) })
  }
  return out
}

/**
 * The most recent confirmation anywhere on the page.
 *
 * ISO-8601 sorts lexically, which is the only reason a string compare is
 * honest here. The room's own `verified_at` is just one more fact in the list —
 * the badge must not fall back to it, because that column is NULL on all
 * seventeen rooms and falling back is precisely the proxy being removed.
 */
export function latestVerified(facts: readonly Fact[]): string | null {
  return facts
    .map((f) => f.verifiedAt)
    .filter((v): v is string => v != null)
    .sort()
    .at(-1) ?? null
}

export type BadgeTone = 'verified' | 'partial' | 'unverified'
export type Badge = { text: string; tone: BadgeTone }

/** `2026-08-06`, or null when there is no usable stamp. */
const day = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10)
}

/**
 * THE HERO BADGE, FROM THE SAME THREE STATES.
 *
 * It read `room.verified_at` — NULL on every room — so Wynn wore
 * "UNVERIFIED · SOURCED" above three in-person receipts and a block saying part
 * of the page is confirmed. Three expressions of one state, two of them using a
 * proxy the third had already replaced.
 *
 * `partial` is a NEW TONE, NOT A NEW VOCABULARY: the states are still
 * none/some/all, and this is what `some` looks like in the header. The wording
 * has to carry a specific burden — say that something here is confirmed WITHOUT
 * claiming the room is — so it names the parts rather than the room. "PARTLY
 * VERIFIED" would still read as a property of the room; "SOME FACTS CONFIRMED"
 * cannot.
 *
 * The tone is deliberately not `verified`'s teal. Teal is the colour that
 * asserts a checked fact, and colour is read before words: a teal badge with a
 * qualifying sentence in it is a teal badge. `partial` therefore takes ordinary
 * text — brighter than the unverified grey, short of the claim.
 */
export function provenanceBadge(
  state: ProvenanceState,
  facts: readonly Fact[],
  fetchedAt: string | null,
): Badge {
  if (state === 'all') {
    const on = day(latestVerified(facts))
    return { text: on ? `VERIFIED ON SITE ${on}` : 'VERIFIED ON SITE', tone: 'verified' }
  }
  if (state === 'some') {
    const on = day(latestVerified(facts))
    return { text: on ? `SOME FACTS CONFIRMED ON SITE ${on}` : 'SOME FACTS CONFIRMED ON SITE', tone: 'partial' }
  }
  return { text: `UNVERIFIED · SOURCED ${day(fetchedAt) ?? '—'}`, tone: 'unverified' }
}

/**
 * WHY A DASH IS A DASH, per figure rather than per room.
 *
 * A dash means two opposite things — "asked, and the room publishes none" or
 * "nobody has looked" — and only the stamp on THAT figure can tell them apart.
 * Asking the room was wrong in both directions at once: it called a confirmed
 * absence a gap, and on a partly-checked room it would vouch for figures nobody
 * had been near.
 */
export function notCheckedTitle(verifiedAt: string | null): string {
  return verifiedAt != null
    ? 'Checked on site — not published for this room'
    : 'Not yet checked on site'
}
