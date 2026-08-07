import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import type { Database } from './database.types'

/**
 * A SESSION-BOUND server client. Still the anon key — the difference is that it
 * carries the signed-in user's JWT, so the database can tell who is asking.
 *
 * THERE IS NO SERVICE-ROLE CLIENT IN THIS CODEBASE, and that is the design.
 * A service key in the app would make every route a potential full-database
 * write path, with nothing but application code between a reader and the
 * maintenance loop. Admin privilege is a row in `admins` and a policy that
 * checks it; if this client is handed to a stranger it can read exactly what a
 * stranger may read.
 *
 * Which also means: `is_admin()` is not a hint for the UI to obey. Every
 * privileged action re-checks it inside the database, so a page that forgot to
 * gate would still be refused.
 */
export async function supabaseSession() {
  const store = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          /* Server Components cannot set cookies. Refreshes land via the route
             handler in app/auth/callback instead, so swallowing here is
             correct rather than lazy — but only here. */
          try {
            for (const { name, value, options } of list) store.set(name, value, options)
          } catch {
            /* called from a Server Component — see above */
          }
        },
      },
    },
  )
}

/**
 * Who is asking, and may they. Returns the email so a page can address the
 * person, and the verdict from the DATABASE rather than from a local list —
 * one definition of the privilege, checked in one place.
 */
export async function whoAmI() {
  const supabase = await supabaseSession()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { email: null as string | null, isAdmin: false, supabase }
  const { data } = await supabase.rpc('is_admin')
  return { email: user.email ?? null, isAdmin: data === true, supabase }
}
