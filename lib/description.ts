/**
 * ROOM DESCRIPTIONS — the interpolation layer.
 *
 * ═══ ⚠️ NO FIGURES TYPED INTO PROSE ═══
 *
 * This repo has run two sweeps for hardcoded numbers that had gone stale, and
 * prose is where that class survives longest. A paragraph reading "they spread
 * $1/2 and $2/5" keeps saying so for a year after the room drops $1/2, and no
 * gate that reads code will ever see it: the sentence is grammatical, it is
 * confident, and it is wrong. It is the same failure as a ranking that quietly
 * skips a room — plausible output with nothing to catch it.
 *
 * So a description that needs a figure carries a TOKEN, and the token resolves
 * from the same query and the same formatter the facts grid uses. An approved
 * queue change moves the paragraph in the same breath as the grid, because
 * there is only one number and only one place it is written down.
 *
 * THREE LAYERS, EACH CATCHING WHAT THE ONE BEFORE IT CANNOT:
 *
 *   1. The schema refuses `$` followed by a digit in `body` — a typed currency
 *      figure is unrepresentable, not merely discouraged.
 *   2. This module resolves tokens, and REFUSES TO PUBLISH a description whose
 *      tokens do not all resolve (see below).
 *   3. The probe reads the RENDERED paragraph and fails if it contains a
 *      currency figure that is not present in that room's own data — which
 *      catches a mis-wired token, the one thing layers 1 and 2 cannot see.
 *
 * ═══ RECORDED, NOT PUBLISHED ═══
 *
 * An unresolved token does not render as `{stakes_lowest}`, and it does not
 * render as a gap in a sentence. The whole description is withheld. That is the
 * `room_formats` precedent applied to prose: a NULL label means "we hold the
 * fact and cannot publish the words", and the difference between recorded and
 * published is drawn on the data rather than on a flag somebody has to
 * maintain. A half-resolved paragraph would be the worst of the three options —
 * it reads as finished.
 *
 * ═══ THE UNVERIFIED MARKER TRAVELS WITH THE FIGURE ═══
 *
 * `~` mid-sentence is not pretty. It is still right: the grid tildes an
 * unverified figure, and prose that states the same figure cleanly would
 * contradict the grid directly above it — the exact shape of the Horseshoe
 * contradiction, where a receipt said "confirmed in person" while the block
 * beside it read as unchecked. One marker, one meaning, everywhere.
 */

import { byStakes, formatRake, type RakeRow, type StakesRow } from './figures.ts'

export type DescriptionRoom = {
  table_count: number | null
  cash_games: ReadonlyArray<RakeRow & StakesRow & {
    verified_at: string | null
    rake_verified_at: string | null
    min_buy_in: number | null
  }>
}

export type ResolvedDescription = {
  /** The paragraph, tokens replaced. Only meaningful when `publish` is true. */
  text: string
  /** Tokens that could not be resolved, in the order they appeared. */
  unresolved: string[]
  /** False when anything failed to resolve — the section renders nothing. */
  publish: boolean
}

/** `{token}` — letters, digits and underscores only, so ordinary braces in
 *  prose are not mistaken for a token we failed to resolve. */
const TOKEN = /\{([a-z0-9_]+)\}/g

/** The unverified marker, matching the grid's `Figure` exactly. */
const mark = (value: string, verifiedAt: string | null) =>
  (verifiedAt != null ? value : `~${value}`)

/**
 * The vocabulary. Deliberately small and deliberately DERIVED — every entry
 * reads the room object the page already fetched, and none of them is allowed
 * a literal. Adding one is a line here; there is no other place to change.
 *
 * A resolver returns null when the room has no such fact, which withholds the
 * whole description rather than printing a hole.
 */
const RESOLVERS: Record<string, (r: DescriptionRoom) => string | null> = {
  table_count: (r) => (r.table_count == null ? null : String(r.table_count)),

  stakes_lowest: (r) => {
    const g = byStakes(r.cash_games)[0]
    return g == null ? null : mark(g.stakes_label, g.verified_at)
  },
  stakes_highest: (r) => {
    const g = byStakes(r.cash_games).at(-1)
    return g == null ? null : mark(g.stakes_label, g.verified_at)
  },
  /* Every stakes the room spreads, in the grid's order. Oxford comma omitted
     to match the product's voice elsewhere. */
  stakes_list: (r) => {
    const gs = byStakes(r.cash_games)
    if (gs.length === 0) return null
    const parts = gs.map((g) => mark(g.stakes_label, g.verified_at))
    if (parts.length === 1) return parts[0]
    return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  },

  buy_in_lowest: (r) => {
    const g = byStakes(r.cash_games)[0]
    if (g == null || g.min_buy_in == null) return null
    return mark(`$${Number(g.min_buy_in)}`, g.verified_at)
  },

  /* THE RAKE RIDES ITS OWN STAMP. A game's buy-ins are verified by
     `verified_at` and its rake by `rake_verified_at`, and the partner cited
     those to different documents on one row — so a rake token can be clean
     while a stakes token in the same sentence is tilded. That looks odd until
     you remember it is the truth. */
  rake_lowest: (r) => {
    const g = byStakes(r.cash_games)[0]
    if (g == null) return null
    const s = formatRake(g)
    return s == null ? null : mark(s, g.rake_verified_at)
  },
}

/** Every token this build knows how to resolve. Exported for the probe. */
export const KNOWN_TOKENS = Object.keys(RESOLVERS).sort()

/**
 * Resolve a description body against a room.
 *
 * An UNKNOWN token — a typo, or one staged through the queue before the
 * resolver for it shipped — is unresolved, not silently left in place. Printing
 * `{stakes_lowset}` to a reader is worse than printing nothing.
 */
export function resolveDescription(body: string, room: DescriptionRoom): ResolvedDescription {
  const unresolved: string[] = []
  const text = body.replace(TOKEN, (whole, name: string) => {
    const fn = RESOLVERS[name]
    if (fn == null) { unresolved.push(name); return whole }
    const v = fn(room)
    if (v == null) { unresolved.push(name); return whole }
    return v
  })
  return { text, unresolved, publish: unresolved.length === 0 }
}

/**
 * Every currency figure in a string, normalised for comparison.
 * Shared with the probe so the gate and the product agree on what counts as a
 * figure — a probe with its own private regex would be asserting against its
 * own idea of the rule.
 */
export function currencyFigures(s: string): string[] {
  return [...s.matchAll(/\$\s?[0-9][0-9,]*(?:\.[0-9]+)?/g)]
    /* CANONICALISED NUMERICALLY, not textually. The database stores rake_cap as
       numeric(6,2) and hands back "6.00"; the grid's formatter prints "$6".
       Those are the same figure, and a probe comparing the strings reported a
       STRAY $6 against a room that plainly holds it — a false accusation, which
       is the failure mode that makes a gate get ignored. Number() collapses
       6.00, 6, and 06 to one value, and $1,500 to 1500. */
    .map((m) => String(Number(m[0].replace(/[$\s,]/g, ''))))
}
