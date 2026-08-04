import { createClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

/**
 * Anon client. The public site is read-only and every table it touches is
 * granted SELECT to `anon` explicitly — RLS policies alone are inert without
 * that grant, which is what `supabase test db` guards.
 *
 * The service key is deliberately absent from this module. Nothing the browser
 * can reach may read `sources`, `pending_changes` or `change_log`.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. ' +
      'Run `supabase start` and copy the values into .env.local.',
  )
}

export const supabase = createClient<Database>(url, anonKey)

export type Room = Database['public']['Tables']['rooms']['Row']
export type CashGame = Database['public']['Tables']['cash_games']['Row']
