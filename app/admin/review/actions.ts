'use server'

import { revalidatePath } from 'next/cache'

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
