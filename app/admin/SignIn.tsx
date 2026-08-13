'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

import { SITE_URL } from '@/lib/site'
import { isStandalone, notStandalone, subscribeToDisplayMode } from '@/lib/install-prompt'

/**
 * TWO WAYS IN, ONE ALLOWLIST.
 *
 * This said "magic link only. No password to leak, reuse or reset" — true when
 * written, and half-false the moment a password path exists, so it is replaced
 * rather than left contradicting the code.
 *
 * WHY A PASSWORD WAS ADDED. The admin address is a mailbox nobody reads, and
 * signing in on three devices meant three trips to it. A password makes the
 * FIRST sign-in on a device cheap; see the session note below for why that is
 * the actual complaint.
 *
 * ⚠️ WHAT DID NOT CHANGE, AND THIS IS THE POINT. Both paths mint the SAME
 * session against the SAME account. `whoAmI()` is untouched, `public.is_admin()`
 * is untouched, and the allowlist is still a row in `public.admins` matched on
 * the JWT's email. A password is a way to PROVE YOU ARE AN ACCOUNT; it is not a
 * way to become an admin. An account that signs in with a password and is not
 * on the allowlist gets the same "signed in but not on the admin allowlist"
 * screen and is still refused by `approve_change`, which authorises internally
 * against `is_admin()` rather than trusting the page that rendered it.
 *
 * ⚠️ THIS IS NOT A SHARED SITE PASSWORD. A password gate with no identity would
 * render the queue and then fail every approval, because the page gate is not
 * the only gate — by design.
 *
 * THE MAGIC LINK STAYS. It is the recovery route when the password is lost, it
 * costs nothing to keep, and it is the only path that works without one.
 *
 * NO PASSWORD SHIPS AND NONE IS SET HERE. Phil sets his own in the Supabase
 * dashboard; nothing in this repo knows it.
 */
export function SignIn() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'link'>('password')
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
   * operating system's decision and the app cannot reach across them.
   *
   * ⚠️ REVISED 2026-08-12, AND THE PASSWORD IS THE REASON. This used to offer
   * NO form here, which was right when the link was the only way in — a form
   * that cannot work is worse than its own absence, because it invites the
   * loop. A PASSWORD does not leave this app: it is posted from here, and the
   * session is written into THIS partition. So the sign-in that could never
   * finish in the installed app is exactly the one this change adds, and
   * hiding it would keep the original complaint alive on the one device where
   * it bites hardest. The LINK is still withheld here, and still explained.
   *
   * DETECTED IN THE BROWSER, NOT ON THE SERVER, because standalone display mode
   * appears in no request header. That means the form renders for one frame
   * before this replaces it, which is the correct trade: the alternative is
   * every reader waiting on JavaScript before they can sign in at all.
   */
  const standalone = useSyncExternalStore(subscribeToDisplayMode, isStandalone, notStandalone)

  const standaloneNotice = standalone ? (
      <div
        data-admin="standalone"
        style={{
          display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)',
          maxWidth: 'var(--cid-measure)',
          borderLeft: '2px solid var(--cid-gold-line)',
          padding: 'var(--cid-space-2) 0 var(--cid-space-2) var(--cid-space-5)',
        }}
      >
        <span className="cid-label">USE YOUR PASSWORD HERE</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
          You are in the installed app, and the emailed link cannot finish here.
          It arrives in your browser, and the app and the browser do not share a
          session — so the link would work, and you would still be signed out on
          this screen. That is why it is not offered.
        </p>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
          A password signs you in right here, because nothing has to leave the
          app. If you do not have one yet, open{' '}
          <span className="num">{`${SITE_URL.replace(/^https:\/\//, '')}/admin`}</span>{' '}
          in Safari or Chrome and use the link there. The queue works the same.
        </p>
      </div>
  ) : null

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault()
    setState('sending')
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      /* ⚠️ THE PROVIDER'S OWN MESSAGE, NOT A CUSTOM ONE. Supabase answers
         "Invalid login credentials" for both a wrong password and an unknown
         address, which is what stops this form becoming an allowlist oracle —
         the same reason the magic-link branch says "if that address is on the
         allowlist". Rewording it per-case would undo that. */
      setState('error'); setDetail(error.message); return
    }
    /* ⚠️ `replace` THEN `refresh`, AND BOTH ARE LOAD-BEARING.
       `whoAmI()` runs on the SERVER, so the verdict only changes if the new
       cookie is on a request. It is: @supabase/ssr's browser client writes the
       session to document.cookie before this promise resolves, so the RSC fetch
       `replace` triggers already carries it. `refresh` then discards any cached
       render of the destination taken while signed out — without it the queue
       can paint from a cache that predates the session.
       `replace`, not `push`, so Back does not return to a sign-in form the
       reader is now past. */
    router.replace('/admin/review')
    router.refresh()
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

  const field = {
    font: 'var(--cid-body)', color: 'var(--cid-text)', background: 'var(--cid-ink-700)',
    border: '1px solid var(--cid-line-2)', borderRadius: 'var(--cid-r-sm)',
    padding: 'var(--cid-space-4)',
  } as const

  /* In the installed app the link cannot finish, so the choice is not offered
     and `mode` is pinned to the one path that can.
     ⚠️ ONE DERIVED FLAG, READ IN FOUR PLACES. Spelling `mode === 'password' ||
     !linkable` at each of the submit handler, the password field, the button
     label and the toggle is four chances to update three of them — and the
     failure that produces is a form showing a password box and submitting the
     magic-link handler, which reports "check your email" and never signs
     anybody in. */
  const linkable = !standalone
  const usingPassword = mode === 'password' || !linkable

  return (
    <>
    {standaloneNotice}
    <form
      onSubmit={usingPassword ? signInWithPassword : send}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)', maxWidth: '360px' }}
    >
      <label className="cid-label" htmlFor="admin-email">EMAIL</label>
      <input
        id="admin-email" type="email" required autoComplete="username"
        value={email} onChange={(e) => setEmail(e.target.value)} style={field}
      />

      {usingPassword && (
        <>
          <label className="cid-label" htmlFor="admin-password">PASSWORD</label>
          <input
            id="admin-password" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} style={field}
          />
        </>
      )}

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
        {usingPassword
          ? (state === 'sending' ? 'SIGNING IN…' : 'SIGN IN')
          : (state === 'sending' ? 'SENDING…' : state === 'sent' ? 'CHECK YOUR EMAIL' : 'SEND SIGN-IN LINK')}
      </button>

      {/* ⚠️ THE LINK IS THE RECOVERY ROUTE AND STAYS ONE TAP AWAY. It is the
          only path that works when the password is lost, and it is what a new
          admin uses before they have one. */}
      {linkable && (
      <button
        type="button"
        onClick={() => { setMode(mode === 'password' ? 'link' : 'password'); setState('idle'); setDetail('') }}
        style={{
          font: 'var(--cid-caption)', color: 'var(--cid-dim)', background: 'none',
          border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {mode === 'password'
          ? 'Email me a sign-in link instead'
          : 'Sign in with a password instead'}
      </button>
      )}

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
    </>
  )
}
