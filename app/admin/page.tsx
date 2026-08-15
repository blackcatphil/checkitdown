import Link from 'next/link'

import { whoAmI } from '@/lib/supabase-admin'

import { SignIn } from './SignIn'

/* Never prerendered: what this page may show depends on who is asking. */
export const dynamic = 'force-dynamic'

export default async function AdminPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  /* IDENTITY FIRST, DATA NEVER. Nothing is queried on this page at all — no
     counts, no room names, no queue size. A payload that says "3 pending
     changes" to a stranger has already leaked that there are three, and
     "fetch then hide" leaks through the RSC payload even when the markup
     looks empty. */
  const { email, isAdmin } = await whoAmI()

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)' }}>
      <span className="cid-label">ADMIN</span>
      <h1 style={{ font: 'var(--cid-statement)', margin: 0 }}>Admin</h1>

      {isAdmin ? (
        <>
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            Signed in as {email}.
          </p>
          {/* A hub, not the queue. Approval stopped being how ordinary data
              arrives when precedence landed — the partner's documents change
              and the app updates itself at 05:00. The queue is one thing you
              might want here, not the thing this page is. */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
            <Link href="/admin/growth" style={{ font: 'var(--cid-body-strong)' }}>Growth console</Link>
            {/* The ledger was a separate screen until 2026-08-15. It is this
                tab now, and /admin/ledger redirects here. */}
            <Link href="/admin/growth?tab=rooms" style={{ font: 'var(--cid-body-strong)' }}>Rooms</Link>
            <Link href="/admin/review" style={{ font: 'var(--cid-body-strong)' }}>Open the queue</Link>
          </nav>
        </>
      ) : (
        <>
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            {email
              ? `${email} is signed in but not on the admin allowlist.`
              : 'This page is for the people who run Check It Down. Sign in to continue.'}
          </p>
          <SignIn />
        </>
      )}

      {error && (
        <p className="cid-unverified" style={{ font: 'var(--cid-caption)' }}>{error}</p>
      )}
    </main>
  )
}
