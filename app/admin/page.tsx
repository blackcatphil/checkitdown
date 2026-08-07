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
      <h1 style={{ font: 'var(--cid-statement)', margin: 0 }}>Review queue</h1>

      {isAdmin ? (
        <>
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            Signed in as {email}.
          </p>
          <Link href="/admin/review" style={{ font: 'var(--cid-body-strong)' }}>Open the queue</Link>
        </>
      ) : (
        <>
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            {email
              ? `${email} is signed in but not on the admin allowlist.`
              : 'This page is for the people who triage scraper findings. Sign in to continue.'}
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
