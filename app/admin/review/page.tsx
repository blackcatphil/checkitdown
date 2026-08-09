import Link from 'next/link'

import { isStaleVerification, orderQueue } from '@/lib/review-order'
import { whoAmI } from '@/lib/supabase-admin'

import { BulkApprove, type SourceGroup } from './BulkApprove'
import { ReviewRow, type Row } from './ReviewRow'

export const dynamic = 'force-dynamic'

export default async function ReviewPage() {
  /* Identity before data, same as /admin: a non-admin never reaches the query,
     so there is no row count to leak in the payload. */
  const { email, isAdmin, supabase } = await whoAmI()
  if (!isAdmin) {
    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0' }}>
        <span className="cid-label">ADMIN</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', maxWidth: 'var(--cid-measure)' }}>
          {email ? `${email} is not on the admin allowlist.` : 'Sign in to review changes.'}
        </p>
        <Link href="/admin">Back to sign-in</Link>
      </main>
    )
  }

  const { data, error } = await supabase
    .from('pending_review')
    .select('*')
    .eq('state', 'pending')
  /* AN EMPTY QUEUE HAS TWO MEANINGS and they render identically: "we checked
     and nothing moved" versus "nobody has looked". Same distinction the
     amenities block makes for a room, and it needs making here for the same
     reason — the second is a gap in our process, the first is the process
     working. */
  const { data: status } = await supabase.rpc('detector_status')
  const detector = (Array.isArray(status) ? status[0] : status) as
    { last_run: string | null; sources_read: number; sources_failing: number } | null

  if (error) {
    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0' }}>
        <p style={{ font: 'var(--cid-body)' }}>Could not read the queue: {error.message}</p>
      </main>
    )
  }

  const rows = orderQueue((data ?? []) as unknown as Row[])
  const stale = rows.filter((r) => isStaleVerification(r.fetched_at, r.fact_verified_at)).length

  /* Grouped for the bulk control, by the DATABASE rather than by this page.
     The label lives in `sources`, which authenticated may not read — so the
     grouping is a definer function gated on is_admin(), the same shape as
     detector_status(). Proposals with no source are absent by construction:
     "approve everything unattributed" is not a one-click decision. */
  const { data: groupData } = await supabase.rpc('pending_source_groups')
  const groups: SourceGroup[] = ((groupData ?? []) as Array<{
    source_id: string
    label: string | null
    pending: number
    would_override: number
  }>).map((g) => ({
    source_id: g.source_id,
    label: g.label ?? 'unlabelled source',
    count: g.pending,
    overrides: g.would_override,
  }))

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)' }}>
      <span className="cid-label">ADMIN · {email}</span>
      <h1 style={{ font: 'var(--cid-statement)', margin: 0 }}>Review queue</h1>
      <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
        {rows.length > 0
          ? `${rows.length} proposal${rows.length === 1 ? '' : 's'} waiting${
              stale > 0 ? `, ${stale} of them taken AFTER the floor visit they contradict — those are first.` : '.'
            }`
          : detector?.last_run
            ? `Nothing to review. The detector last ran ${new Date(detector.last_run).toISOString().slice(0, 16).replace('T', ' ')} and read ${detector.sources_read} source${detector.sources_read === 1 ? '' : 's'} without finding a disagreement${
                detector.sources_failing > 0
                  ? `; ${detector.sources_failing} source${detector.sources_failing === 1 ? '' : 's'} could not be read at all, which is a gap in coverage rather than a clean result.`
                  : '.'
              }`
            : 'The detector has never run. This queue is empty because nothing has looked yet — not because nothing has changed.'}
      </p>

      <BulkApprove groups={groups} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)' }}>
        {rows.map((r) => (
          <ReviewRow key={r.id} row={r} stale={isStaleVerification(r.fetched_at, r.fact_verified_at)} />
        ))}
      </div>
    </main>
  )
}
