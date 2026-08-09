'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useState } from 'react'

/**
 * Magic link only. No password to leak, reuse or reset, and the allowlist is a
 * row in the database rather than a role on the account — so revoking access is
 * a DELETE, not a support conversation.
 */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [detail, setDetail] = useState('')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    /* THE LINK'S SHAPE IS DECIDED BY THE EMAIL TEMPLATE, NOT HERE.
       This call is unchanged by the 2026-08-09 move off PKCE: the template
       renders {{ .TokenHash }} and this URL becomes {{ .RedirectTo }}, so
       `next` still travels in code rather than being baked into a dashboard
       field. See app/auth/callback/route.ts for why PKCE was abandoned —
       briefly, it needed a secret the browser had to still be holding when the
       link was clicked, and mail clients routinely break that.

       The client's own flowType is left at its default. It mints a verifier
       that the token_hash flow never reads, which is harmless, and leaving it
       is what keeps a link minted under the OLD template still working. */
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin/review` },
    })
    if (error) { setState('error'); setDetail(error.message); return }
    setState('sent')
  }

  return (
    <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)', maxWidth: '360px' }}>
      <label className="cid-label" htmlFor="admin-email">EMAIL</label>
      <input
        id="admin-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          font: 'var(--cid-body)', color: 'var(--cid-text)', background: 'var(--cid-ink-700)',
          border: '1px solid var(--cid-line-2)', borderRadius: 'var(--cid-r-sm)',
          padding: 'var(--cid-space-4)',
        }}
      />
      <button
        type="submit"
        disabled={state === 'sending' || state === 'sent'}
        style={{
          font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-action)',
          color: 'var(--cid-paper)', background: 'var(--cid-accent-700)',
          borderTop: '1px solid var(--cid-gold-300)', border: 'none',
          borderRadius: 'var(--cid-r-sm)', minHeight: 'var(--cid-target)', cursor: 'pointer',
        }}
      >
        {state === 'sending' ? 'SENDING…' : state === 'sent' ? 'CHECK YOUR EMAIL' : 'SEND SIGN-IN LINK'}
      </button>
      {/* A link is sent to any address that asks. Saying "sent, IF that address
          is on the list" avoids turning this form into an allowlist oracle. */}
      {state === 'sent' && (
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0 }}>
          If that address is on the allowlist, a sign-in link is on its way.
        </p>
      )}
      {state === 'error' && (
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-text-3)', margin: 0 }}>{detail}</p>
      )}
    </form>
  )
}
