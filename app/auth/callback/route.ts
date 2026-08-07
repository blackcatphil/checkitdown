import { NextResponse } from 'next/server'

import { supabaseSession } from '@/lib/supabase-admin'

/**
 * Where the magic link lands. A ROUTE HANDLER rather than a page, because this
 * is the one place that may actually write the session cookies — Server
 * Components cannot, which is why the client's setAll swallows there.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/admin'

  if (code) {
    const supabase = await supabaseSession()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, url.origin))
    /* Say which step failed. "Sign-in didn't work" sends someone to check their
       password on a site that has none. */
    return NextResponse.redirect(new URL(`/admin?error=${encodeURIComponent(error.message)}`, url.origin))
  }
  return NextResponse.redirect(new URL('/admin?error=no+code+in+callback', url.origin))
}
