'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useState, useSyncExternalStore } from 'react'

import { SITE_URL } from '@/lib/site'
import { isStandalone, notStandalone, subscribeToDisplayMode } from '@/lib/install-prompt'

/**
 * Magic link only. No password to leak, reuse or reset, and the allowlist is a
 * row in the database rather than a role on the account — so revoking access is
 * a DELETE, not a support conversation.
 */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [detail, setDetail] = useState('')
  /**
   * THE INSTALLED-APP TRAP, DECIDED BEFORE IT WAS DISCOVERED — 2026-08-11.
   *
   * An installed PWA has its own storage, separate from the browser that
   * installed it. A magic link opened from a mail app lands in the BROWSER, so
   * the session cookie is written into a jar this app cannot read. The reader
   * sees: link tapped, browser opens, "signed in" — then switches back to the
   * app they were standing in and is still signed out. Nothing errors. Nothing
   * logs. The link was consumed, so tapping it again fails too, and the obvious
   * next move is to request another one and repeat the whole thing.
   *
   * There is no fix available to us: the two storage partitions are the
   * operating system's decision and the app cannot reach across them. So the
   * form is not offered here at all. A form that cannot work is worse than its
   * own absence — it invites the loop.
   *
   * DETECTED IN THE BROWSER, NOT ON THE SERVER, because standalone display mode
   * appears in no request header. That means the form renders for one frame
   * before this replaces it, which is the correct trade: the alternative is
   * every reader waiting on JavaScript before they can sign in at all.
   */
  const standalone = useSyncExternalStore(subscribeToDisplayMode, isStandalone, notStandalone)

  if (standalone) {
    return (
      <div
        data-admin="standalone"
        style={{
          display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)',
          maxWidth: 'var(--cid-measure)',
          borderLeft: '2px solid var(--cid-gold-line)',
          padding: 'var(--cid-space-2) 0 var(--cid-space-2) var(--cid-space-5)',
        }}
      >
        <span className="cid-label">OPEN THIS IN YOUR BROWSER</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
          You are in the installed app, and sign-in cannot finish here. The link
          we email arrives in your browser, and the app and the browser do not
          share a session — so the link would work, and you would still be
          signed out on this screen.
        </p>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
          Open <span className="num">{`${SITE_URL.replace(/^https:\/\//, '')}/admin`}</span>{' '}
          in Safari or Chrome and sign in there. The queue works the same.
        </p>
      </div>
    )
  }

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
