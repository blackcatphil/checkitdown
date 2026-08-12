/**
 * WHO WROTE THE DESCRIPTION THAT IS ABOUT TO BE OVERWRITTEN.
 *
 * ═══ THE RECEIPT RULE ═══
 *
 * A body that moves without its authorship leaves a citation describing a
 * different text. `room_descriptions` carries one row per room with a
 * `source_url` and an `author_kind`, and an UPDATE that changes `body` while
 * leaving `author_kind` alone produces a row that says our house prose is at a
 * partner's URL, or the reverse. Nothing in the schema notices: both columns are
 * individually valid, and the row reads perfectly.
 *
 * It surfaced on 2026-08-12 as three sync failures — horseshoe, westgate and
 * caesars-palace — where partner prose containing dollar figures landed on rows
 * still labelled `checkitdown` and hit `description_states_no_currency`. That
 * CHECK is doing its job and is not the problem: it caught the mislabelling by
 * accident, because our prose may not state figures and a partner's may. The
 * silent case is the same bug without the figures — a partner review with no
 * dollar amounts overwrites our text, the row keeps saying `checkitdown`,
 * nothing raises, and the description is attributed to the wrong author
 * permanently.
 *
 * ═══ ⚠️ THE MOVE IS NOT SYMMETRIC ═══
 *
 * PARTNER MAY REPLACE OURS. A partner review is first-hand: somebody sat in the
 * room. §3.1 ranks floor above web, and the partner document is the floor tier
 * here.
 *
 * OURS MUST NEVER REPLACE A PARTNER'S. `scripts/stage-description.mjs` is run by
 * hand and writes `checkitdown` prose; without this rule it can silently
 * downgrade a first-hand review to house copy, with no record that a review was
 * ever there. That is a demotion of evidence performed by a convenience script,
 * which is exactly the shape of thing the precedence law exists to forbid.
 *
 * Same-tier moves are allowed: a rewritten partner review replaces the previous
 * partner review, and our prose may be edited by us.
 */
export type AuthorKind = 'partner' | 'checkitdown'

export type AuthorshipMove =
  | { allowed: true; carries: AuthorKind }
  | { allowed: false; reason: string }

/**
 * May `incoming` prose replace what `existing` holds, and what must the row's
 * `author_kind` become?
 *
 * `existing` is null when there is no row yet — an insert, which is always
 * allowed and simply carries its own authorship.
 */
export function authorshipMove(
  existing: AuthorKind | null,
  incoming: AuthorKind,
): AuthorshipMove {
  if (existing === null) return { allowed: true, carries: incoming }

  if (existing === 'partner' && incoming === 'checkitdown') {
    return {
      allowed: false,
      reason:
        'refusing to replace a PARTNER review with Check It Down prose. A partner '
        + 'review is first-hand and outranks house copy (§3.1), and this would '
        + 'overwrite it leaving no record that a review was ever there. If the '
        + 'review is genuinely gone from the source document, remove the row '
        + 'deliberately rather than writing over it.',
    }
  }

  /* ⚠️ `carries` IS RETURNED EVEN WHEN THE KIND IS UNCHANGED, and the caller is
     expected to write it every time. An update that sets author_kind only when
     it changes is one `if` away from the bug this file exists to prevent, and
     writing a column to the value it already holds costs nothing. */
  return { allowed: true, carries: incoming }
}
