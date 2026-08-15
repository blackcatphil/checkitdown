'use client'

import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * THE RECOVERY ROUTE. Until this existed there was none: a reset email landed
 * on the homepage, nothing read the token, and the only way to set a password
 * was to write to `auth.users` directly.
 *
 * ═══ WHY THIS IS A CLIENT COMPONENT, WHICH IS NOT A PREFERENCE ═══
 *
 * The link in the email points at GoTrue's own `/auth/v1/verify`, not at us.
 * GoTrue consumes the token there and 303s here with the session in the URL
 * FRAGMENT — and a fragment is never transmitted to a server. So the session
 * this page exists to receive is, by construction, only visible to a browser.
 * That is also why the magic-link flow could use a route handler and this one
 * cannot: that link carries a `token_hash` in the QUERY, which does reach the
 * server. Two different link shapes, two different places they can be read.
 *
 * ═══ THE THREE REFUSALS ═══
 *
 * ⚠️ A RESET PAGE THAT ACCEPTS A SPENT TOKEN IS WORSE THAN NO RESET PAGE, so
 * each refusal is separate and none of them is the absence of a success:
 *
 *   EXPIRED / ALREADY USED — GoTrue verifies before we ever run, and redirects
 *     with `#error=access_denied&error_code=otp_expired`. The fragment is read
 *     for an error BEFORE it is read for tokens, so a spent link cannot fall
 *     through into the form. Both cases arrive under the same code, which is
 *     the auth server's decision, not ours — so both are refused by one branch
 *     and the reader is told to request a fresh link either way.
 *
 *   NOT ON THE ALLOWLIST — a valid token proves you hold an ADDRESS. It does
 *     not make you an admin, exactly as a password does not (see SignIn.tsx).
 *     `is_admin()` is asked of the DATABASE, and a refusal SIGNS THE SESSION
 *     OUT rather than merely hiding the form: leaving a live session behind a
 *     hidden form is a gate you can walk around with the developer tools.
 *
 * ═══ THE INSTALLED APP ═══
 *
 * The link opens wherever the mail app sends it, which is the browser, and the
 * browser's storage is a different partition from the installed app's — the
 * same wall documented in SignIn.tsx. So a recovery link cannot complete inside
 * the PWA and this page says so when it is opened there with nothing to work
 * on. It is NOT blocked outright: an admin already signed in on this device may
 * change their password here, which needs no link and crosses no partition.
 * After a reset, the PWA is reachable again with the new PASSWORD, which is the
 * whole reason the password path was added.
 */

/** Whatever the URL carried when this page loaded, read once. */
type Landing =
  | { kind: 'none' }
  | { kind: 'error', code: string, description: string }
  | { kind: 'session', accessToken: string, refreshToken: string }
  /** A PKCE `?code=` in the QUERY — what production actually sends. */
  | { kind: 'pkce', code: string }

/**
 * ⚠️ READ SYNCHRONOUSLY, BEFORE ANY SUPABASE CLIENT EXISTS.
 *
 * supabase-js has a `detectSessionInUrl` behaviour that consumes the fragment
 * on its own. If it wins the race the hash is gone before this runs, and the
 * page reports "no link" to somebody holding a valid one. The client below is
 * therefore constructed with that behaviour OFF and the fragment is handled
 * here explicitly — the flow is legible in one place rather than split between
 * our code and a library default that could change under us.
 */
/**
 * ⚠️ THE QUERY IS READ TOO, AND FOR A WHILE IT WAS NOT.
 *
 * A real link from Phil's inbox read `/admin/password?code=<uuid>` — PKCE, in
 * the QUERY. This page handled the implicit fragment and the token_hash shape,
 * so it looked at a valid reset link and said "there is no reset link on this
 * page". It was not wrong about what it could read; it was wrong to describe
 * that as nothing being there.
 *
 * New links are routed through /auth/callback, which exchanges the code
 * server-side (see SignIn.tsx). This branch is for the ones ALREADY SENT, which
 * point straight here — and for saying something true when the exchange cannot
 * be done at all.
 */
function readLanding(hash: string, search: string): Landing {
  const fromHash = readFragment(hash)
  if (fromHash.kind !== 'none') return fromHash
  const code = new URLSearchParams(search).get('code')
  if (code) return { kind: 'pkce', code }
  return { kind: 'none' }
}

function readFragment(hash: string): Landing {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  const error = p.get('error') ?? p.get('error_code')
  if (error) {
    return {
      kind: 'error',
      code: p.get('error_code') ?? p.get('error') ?? 'unknown',
      description: p.get('error_description')?.replace(/\+/g, ' ') ?? '',
    }
  }
  const accessToken = p.get('access_token')
  const refreshToken = p.get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken }
  return { kind: 'none' }
}

type Gate =
  | { state: 'checking' }
  | { state: 'ready', email: string }
  | { state: 'refused', why: string, detail: string, standalone: boolean }

export function SetPassword() {
  const router = useRouter()
  const [gate, setGate] = useState<Gate>({ state: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /**
   * ⚠️ EXACTLY ONCE, AND THIS GUARD IS NOT DEFENSIVE PROGRAMMING.
   *
   * This effect CONSUMES the URL fragment — it reads it and then strips it from
   * the address bar. React invokes effects twice in development (StrictMode),
   * and the second invocation found a fragment the first had already removed,
   * so the page told a reader holding a perfectly good reset link that there
   * was no link on the page. Caught by red-proving the consumed-token case,
   * where the WRONG refusal was rendering and two assertions were passing on it
   * because they only checked that no password field appeared.
   *
   * A ref guard is the right instrument here rather than a smell: the fragment
   * is a one-shot resource, so "run this once per mount" is the actual
   * requirement, not a workaround for one that was mis-stated.
   */
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    /* Grab the fragment before anything else can touch it, then remove it from
       the address bar. Access and refresh tokens in a URL end up in history,
       in a bookmark, and in any screenshot of the browser — and the reader has
       no idea they are there. */
    const landing = readLanding(window.location.hash, window.location.search)
    /* A `code` is a credential too — it buys a session for anyone holding it —
       so it comes out of the address bar for the same reason the tokens do. */
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', window.location.pathname)
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    )
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
      || (window.navigator as { standalone?: boolean }).standalone === true

    void (async () => {
      /* 1. A SPENT OR EXPIRED LINK IS REFUSED BEFORE ANYTHING ELSE IS READ. */
      if (landing.kind === 'error') {
        setGate({
          state: 'refused', standalone: false,
          why: landing.code === 'otp_expired'
            ? 'That link has expired or has already been used.'
            : 'That link was refused.',
          detail: landing.description
            + ' A reset link works once. Request a new one from the sign-in page.',
        })
        return
      }

      /* 2. Adopt the session the link carried. A cookie session may already be
            here instead — that is /auth/callback having landed us, or an admin
            already signed in on this device changing their own password. */
      if (landing.kind === 'session') {
        const { error: setErr } = await supabase.auth.setSession({
          access_token: landing.accessToken,
          refresh_token: landing.refreshToken,
        })
        if (setErr) {
          setGate({
            state: 'refused', standalone: false,
            why: 'That link could not be used.',
            detail: `${setErr.message}. Request a new one from the sign-in page.`,
          })
          return
        }
      }

      /* 2b. A PKCE CODE. The exchange needs the verifier this browser stored
             when the reset was requested — @supabase/ssr keeps it in a cookie,
             so it is here IF this is that browser. It very often is not: the
             link is opened from a mail app, on a phone, in a webview. That is
             the failure that got PKCE abandoned for sign-in on 2026-08-09, and
             it is the reason the email template is still owed a rewrite. */
      if (landing.kind === 'pkce') {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(landing.code)
        if (exErr) {
          setGate({
            state: 'refused', standalone,
            why: 'That is a reset link, and it cannot be completed in this browser.',
            detail: 'Password links carry a secret that stays in the browser you '
              + 'requested the reset from, so it only works there. Open the link in '
              + 'that browser, or request a new one here and use it on this device.',
          })
          return
        }
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setGate({
          state: 'refused', standalone,
          why: 'There is no reset link on this page.',
          detail: 'Open the link from your email, or request one from the sign-in page.',
        })
        return
      }

      /* 3. THE ALLOWLIST, ASKED OF THE DATABASE. A token proves an address. */
      const { data: isAdmin } = await supabase.rpc('is_admin')
      if (isAdmin !== true) {
        /* ⚠️ SIGNED OUT, NOT JUST REFUSED. Hiding the form while leaving the
           session live is not a refusal — it is a form you can re-render. */
        await supabase.auth.signOut()
        setGate({
          state: 'refused', standalone: false,
          why: `${user.email} is not on the admin allowlist.`,
          detail: 'The link was valid, and it does not grant access here. '
            + 'You have been signed out.',
        })
        return
      }

      setGate({ state: 'ready', email: user.email ?? '' })
    })()
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('The two passwords do not match.'); return }
    setSaving(true)
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    )
    /* The length and complexity policy lives in the auth server, not here. A
       second copy in this file would be a second place to be wrong, and the
       one that matters is the one that rejects. */
    const { error: upErr } = await supabase.auth.updateUser({ password })
    if (upErr) { setSaving(false); setError(upErr.message); return }
    router.replace('/admin/review')
    router.refresh()
  }

  const field = {
    font: 'var(--cid-body)', color: 'var(--cid-text)', background: 'var(--cid-ink-700)',
    border: '1px solid var(--cid-line-2)', borderRadius: 'var(--cid-r-sm)',
    padding: 'var(--cid-space-4)',
  } as const

  if (gate.state === 'checking') {
    return (
      <p data-password="checking" style={{ font: 'var(--cid-body)', color: 'var(--cid-dim)', margin: 0 }}>
        Checking that link…
      </p>
    )
  }

  if (gate.state === 'refused') {
    return (
      <div
        data-password="refused"
        style={{
          display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)',
          maxWidth: 'var(--cid-measure)',
          borderLeft: '2px solid var(--cid-gold-line)',
          padding: 'var(--cid-space-2) 0 var(--cid-space-2) var(--cid-space-5)',
        }}
      >
        <span className="cid-label">THIS LINK CANNOT SET A PASSWORD</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>{gate.why}</p>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>{gate.detail}</p>
        {gate.standalone && (
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
            You are in the installed app. A reset link arrives in your browser,
            and the app and the browser do not share a session — so it cannot
            finish here. Reset it in your browser, then come back and sign in
            with the new password.
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      data-password="ready"
      onSubmit={save}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)', maxWidth: '360px' }}
    >
      <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
        Signed in as {gate.email}. Choose a new password.
      </p>
      {/* Carries the address for the browser's password manager, which will not
          offer to save a credential it cannot attach to a username. */}
      <input type="email" autoComplete="username" value={gate.email} readOnly hidden />

      <label className="cid-label" htmlFor="new-password">NEW PASSWORD</label>
      <input
        id="new-password" type="password" required autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)} style={field}
      />
      <label className="cid-label" htmlFor="confirm-password">CONFIRM</label>
      <input
        id="confirm-password" type="password" required autoComplete="new-password"
        value={confirm} onChange={(e) => setConfirm(e.target.value)} style={field}
      />

      <button
        type="submit"
        disabled={saving}
        style={{
          font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-action)',
          color: 'var(--cid-paper)', background: 'var(--cid-accent-700)',
          border: 'none', borderRadius: 'var(--cid-r-sm)',
          minHeight: 'var(--cid-target)', cursor: 'pointer',
        }}
      >
        {saving ? 'SAVING…' : 'SET PASSWORD'}
      </button>

      {error && (
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-text-3)', margin: 0 }}>{error}</p>
      )}
    </form>
  )
}
