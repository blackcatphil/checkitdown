'use server'

import { revalidatePath } from 'next/cache'

import { approveSequentially, describeBulkResult } from '@/lib/bulk-approve'
import { orderQueue, type QueueRow } from '@/lib/review-order'
import { supabaseSession } from '@/lib/supabase-admin'

/**
 * THE FIRST WRITER IN THIS CODEBASE, and therefore the first caller of
 * revalidatePath — which was deliberately left unwired until now, because a
 * cache safeguard with nothing to invalidate is dead code that looks like
 * coverage.
 *
 * Neither action decides anything. `approve_change` and `reject_change` are
 * SECURITY DEFINER functions that re-check `is_admin()` themselves, so these
 * are transport: if this file were deleted and the RPC called directly, the
 * same rules would apply.
 */

type Result = { ok: true; overrode: boolean } | { ok: false; error: string }

export async function approve(id: string, overrideVerified: boolean): Promise<Result> {
  const supabase = await supabaseSession()
  const { data, error } = await supabase.rpc('approve_change', {
    p_id: id,
    p_override_verified: overrideVerified,
  })
  if (error) return { ok: false, error: error.message }

  const applied = data as { slug: string | null; overrode_verified: boolean }
  /* The room page is prerendered with revalidate=300, so without this an
     approved change is invisible for five minutes on the one surface a reader
     would check. /facts is dynamic but ranks on the values just changed. */
  if (applied?.slug) revalidatePath(`/rooms/${applied.slug}`)
  revalidatePath('/facts')
  revalidatePath('/admin/review')
  return { ok: true, overrode: applied?.overrode_verified === true }
}

export async function reject(id: string): Promise<Result> {
  const supabase = await supabaseSession()
  const { error } = await supabase.rpc('reject_change', { p_id: id })
  if (error) return { ok: false, error: error.message }
  /* Nothing public changed, so nothing public is revalidated. */
  revalidatePath('/admin/review')
  return { ok: true, overrode: false }
}

/**
 * APPROVE EVERY PENDING PROPOSAL FROM ONE SOURCE.
 *
 * The morning partner apply is sixty rows from one spreadsheet and ONE
 * decision — "I trust this document" — so the queue should ask for it once.
 * What it must not do is turn sixty validations into one: this loops
 * `approve_change` per row, so each proposal keeps its own field check, its own
 * room-ownership check, its own change_log entry and its own revalidation.
 *
 * `p_override_verified` IS FALSE HERE, AND THAT IS THE POINT. Overriding a
 * floor visit is a per-row human judgement — "I know this changed since he
 * stood there" — and it cannot be delegated to a button that means "all of
 * them". A proposal that would override stops the run and says so, and the
 * reviewer approves that one by hand with the button that names the
 * consequence. Bulk is for the routine bulk; the interesting row still gets a
 * person.
 *
 * Not gated on is_admin() here: it is gated in `approve_change`, which
 * re-checks it inside the database on every single call. A check in this file
 * would be a second opinion that cannot be trusted anyway.
 */
export async function approveAllFromSource(
  sourceId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const supabase = await supabaseSession()

  /* Read the ids in the queue's own order, so "row 4 stopped it" counts the
     rows the reviewer is actually looking at. */
  const { data, error } = await supabase
    .from('pending_review')
    .select('id, fetched_at, fact_verified_at, confidence, created_at')
    .eq('state', 'pending')
    .eq('source_id', sourceId)
  if (error) return { ok: false, error: error.message }

  const rows = orderQueue((data ?? []) as unknown as QueueRow[]) as Array<QueueRow & { id: string }>
  if (rows.length === 0) return { ok: false, error: 'No pending proposals from that source.' }

  /* The label comes from the same definer function the buttons were built
     from — `sources` is service_only, so this file cannot read it directly. */
  const { data: groups } = await supabase.rpc('pending_source_groups')
  const label =
    ((groups ?? []) as Array<{ source_id: string; label: string | null }>)
      .find((g) => g.source_id === sourceId)?.label ?? 'that source'

  const result = await approveSequentially(
    rows.map((r) => r.id),
    async (id) => {
      const { data: applied, error: e } = await supabase.rpc('approve_change', {
        p_id: id,
        p_override_verified: false,
      })
      if (e) return { ok: false, error: e.message }
      const row = applied as { slug: string | null } | null
      /* Per row, not once at the end: if the run stops halfway, the pages that
         did change are already correct rather than waiting on a revalidation
         that the failure skipped. */
      if (row?.slug) revalidatePath(`/rooms/${row.slug}`)
      return { ok: true, slug: row?.slug ?? null }
    },
  )

  if (result.approved > 0) revalidatePath('/facts')
  revalidatePath('/admin/review')

  return { ok: true, message: describeBulkResult(result, label) }
}
