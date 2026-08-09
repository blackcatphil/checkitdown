import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

import { supabaseSession } from '@/lib/supabase-admin'

/**
 * Where the magic link lands. A ROUTE HANDLER rather than a page, because this
 * is the one place that may actually write the session cookies — Server
 * Components cannot, which is why the client's setAll swallows there.
 *
 * ═══ WHY token_hash AND NOT PKCE (2026-08-09) ═══
 *
 * Sign-in failed with "PKCE code verifier not found in storage" while
 * Supabase's own logs showed /verify succeeding (auth_event action=login). The
 * link was fine and the URL config was fine; the exchange was not.
 *
 * PKCE needs a SECRET THAT THE BROWSER STORED when the link was requested, and
 * that verifier has to survive: the tab being closed, the mail app opening the
 * link in a different browser or a webview, an ITP/anti-tracking sweep, or a
 * device swap. Every one of those is normal behaviour for "click a link in
 * email", and every one of them loses the cookie. It could not be reproduced
 * from here because it depends on which browser opens the mail.
 *
 * The token_hash flow carries no browser-stored secret at all. The link holds a
 * single-use hash, this route verifies it server-side, and the session cookies
 * are written here. There is nothing for a browser to lose between the request
 * and the click — which is why Supabase recommends it for SSR.
 *
 * BOTH PATHS ARE KEPT, because the branch is four lines. A link already in
 * Phil's inbox, minted under the old template, still lands. That is NOT a fix
 * for those links — a `code` link still needs the verifier this bug is about,
 * and it will still fail if the cookie is gone. It only means an old link
 * reports the same honest error instead of "no code in callback".
 */

/** The types Supabase can mint for an email link. Validated rather than
 *  trusted: `type` arrives in a URL and is handed straight to the auth server,
 *  so an unrecognised value is refused here instead of being forwarded. */
const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email',
])

/**
 * WHERE THE CALLBACK IS ALLOWED TO SEND SOMEBODY.
 *
 * `next` arrives in the URL of a SIGN-IN LINK — the one thing people forward —
 * so an open redirect here hands an attacker a link that carries our domain,
 * our branding and a real successful login before it lands somewhere else.
 *
 * ═══ THE BYPASSES, EACH VERIFIED RATHER THAN IMAGINED ═══
 *
 * The first guard was `startsWith('/') && !startsWith('//')`, and it let two
 * things through:
 *
 *   `//evil.example`   — closed by the second clause.
 *   `/\evil.example`   — NOT closed. The URL spec normalises a backslash to a
 *                        forward slash, so this passed a check written in
 *                        terms of '/' and then resolved to https://evil.example/.
 *   `/<TAB>/evil.example` — also not closed, and found while checking the
 *                        above. The URL parser STRIPS tab, CR and LF, so the
 *                        string the guard inspects is not the string the
 *                        parser resolves; `/`+TAB+`/evil` becomes `//evil`
 *                        after the guard has already approved it.
 *
 * Three members of one class, and the third turned up in ten minutes. So the
 * character checks are kept — they are the ruled guard, they fail fast, and
 * they say plainly what is disallowed — but they are NOT the thing relied on.
 * The load-bearing check is POSITIVE: resolve the URL the way the browser
 * will, and require the result to be on our own origin. A denylist answers the
 * bypasses somebody has already thought of; this answers the ones nobody has.
 *
 * Returning the RE-SERIALISED path rather than the caller's string matters for
 * the same reason: whatever the parser stripped or folded is gone by the time
 * anything downstream sees it, so there is no second interpretation left.
 */
export function safeNext(raw: string | null, origin: string): string {
  const fallback = '/admin'
  if (raw == null) return fallback

  /* The ruled trio. Relative, not protocol-relative, no backslash. */
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//')) return fallback
  if (raw.includes('\\')) return fallback

  /* And the check that does not depend on having predicted the trick. */
  let resolved: URL
  try {
    resolved = new URL(raw, origin)
  } catch {
    return fallback
  }
  if (resolved.origin !== origin) return fallback

  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const dest = safeNext(url.searchParams.get('next'), url.origin)

  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(msg)}`, url.origin))

  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type')
  const code = url.searchParams.get('code')

  if (tokenHash) {
    if (rawType == null) return fail('link is missing type')
    if (!EMAIL_OTP_TYPES.has(rawType as EmailOtpType)) {
      return fail(`unrecognised link type: ${rawType}`)
    }
    const supabase = await supabaseSession()
    const { error } = await supabase.auth.verifyOtp({
      type: rawType as EmailOtpType,
      token_hash: tokenHash,
    })
    if (!error) return NextResponse.redirect(new URL(dest, url.origin))
    /* Say which step failed. "Sign-in didn't work" sends someone to check their
       password on a site that has none — and it is what diagnosed this bug. */
    return fail(error.message)
  }

  if (code) {
    const supabase = await supabaseSession()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(dest, url.origin))
    return fail(error.message)
  }

  return fail('no token_hash or code in callback')
}
