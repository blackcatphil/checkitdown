/**
 * BULK APPROVAL, SEQUENCED — the loop, kept out of the server action so it can
 * be tested without a database, a session or a browser.
 *
 * ONE DECISION, NOT SIXTY CLICKS — BUT STILL SIXTY APPROVALS. This walks the
 * ids and calls the same `approve_change` the single-row button calls, once per
 * row. There is deliberately NO set-based SQL path: a statement that approved
 * sixty proposals at once would have to re-implement the per-row validation,
 * the change_log entry and the verified-fact refusal, and the copy that drifts
 * is always the one nobody is looking at. The saving is in the reviewer's
 * attention, not in the number of statements.
 *
 * IT STOPS AT THE FIRST FAILURE, AND SAYS WHERE. A bulk action that carries on
 * past a refusal leaves the queue half-applied and reports a number — the
 * reviewer then has to work out which rows landed by reading the database. So
 * the first refusal ends the run, and the result names the row, its position,
 * the reason, and how many were never attempted. Partial application is a fact
 * about the world; the only question is whether it is visible.
 *
 * Sequential rather than concurrent, also deliberately: `approve_change` takes
 * `for update` on the proposal and writes fact tables, and sixty concurrent
 * calls would interleave their revalidation and make "which row stopped it"
 * meaningless.
 */

export type ApproveOutcome =
  | { ok: true; slug: string | null }
  | { ok: false; error: string }

export type BulkResult = {
  /** Proposals approved before the run ended. */
  approved: number
  /** Distinct room slugs touched, for the caller to revalidate. */
  slugs: string[]
  /** The row that ended the run, or null if every row applied. */
  stoppedAt: { id: string; index: number; error: string } | null
  /** Rows never attempted because the run stopped. */
  unattempted: number
}

export async function approveSequentially(
  ids: string[],
  approveOne: (id: string) => Promise<ApproveOutcome>,
): Promise<BulkResult> {
  const slugs: string[] = []
  let approved = 0

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const outcome = await approveOne(id)
    if (!outcome.ok) {
      return {
        approved,
        slugs,
        stoppedAt: { id, index: i, error: outcome.error },
        /* The failing row is not "unattempted" — it was attempted and refused.
           Only the ones behind it never got a turn. */
        unattempted: ids.length - i - 1,
      }
    }
    approved++
    if (outcome.slug && !slugs.includes(outcome.slug)) slugs.push(outcome.slug)
  }

  return { approved, slugs, stoppedAt: null, unattempted: 0 }
}

/** What the reviewer reads. Kept here so the wording is tested, not typed twice. */
export function describeBulkResult(r: BulkResult, sourceLabel: string): string {
  const n = `${r.approved} proposal${r.approved === 1 ? '' : 's'}`
  if (!r.stoppedAt) return `Applied ${n} from ${sourceLabel}.`
  return (
    `Stopped at row ${r.stoppedAt.index + 1}: ${r.stoppedAt.error}. ` +
    `${n} applied before it; ${r.unattempted} not attempted. ` +
    `The queue is partly applied — re-run after resolving that row.`
  )
}
