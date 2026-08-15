import Link from 'next/link'

import { SetPassword } from './SetPassword'

/* Never prerendered. The recovery session arrives in the URL fragment, so this
   page's meaning is decided entirely in the browser — but a cached HTML shell
   would still be wrong to serve, because /auth/callback can also land here with
   cookies already set and that render depends on who is asking. */
export const dynamic = 'force-dynamic'

/**
 * WHERE A RECOVERY LINK LANDS.
 *
 * ⚠️ THIS PAGE READS NOTHING ON THE SERVER, AND THAT IS FORCED, NOT CHOSEN.
 * A recovery link goes to GoTrue's own `/auth/v1/verify`, which consumes the
 * token and 303s here with the session in the URL FRAGMENT:
 *
 *   /admin/password#access_token=…&refresh_token=…&type=recovery
 *
 * A fragment is never sent to a server. No route handler, no Server Component
 * and no middleware can see it — so `whoAmI()` here would report "signed out"
 * for a reader who is holding a perfectly good session, and gating on that
 * would refuse every genuine reset. The identity check therefore happens in
 * SetPassword.tsx, against the DATABASE via `is_admin()`, which is the same
 * authority every other gate uses and is not weakened by running from a client.
 */
export default function AdminPasswordPage() {
  return (
    <main
      className="cid-page"
      style={{
        padding: 'var(--cid-space-9) 0', display: 'flex',
        flexDirection: 'column', gap: 'var(--cid-space-6)',
      }}
    >
      <span className="cid-label">ADMIN</span>
      <h1 style={{ font: 'var(--cid-statement)', margin: 0 }}>Set a new password</h1>
      <SetPassword />
      <Link href="/admin" style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
        Back to sign-in
      </Link>
    </main>
  )
}
