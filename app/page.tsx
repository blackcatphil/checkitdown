import { MapClient } from './MapClient'
import type { MapRoom } from './MapShell'

import { supabase } from '@/lib/supabase'

export const revalidate = 300

/** game_kind -> the four filter keys the panel ships with. `stud` and `other`
 *  map to none of them: a room that only spreads stud matches no game filter,
 *  which is correct — there is no STUD checkbox to claim otherwise. */
const GAME_KEY: Record<string, string> = {
  nlh: 'nlh', plo: 'plo', plo5: 'plo', lhe: 'limit', mixed: 'mixed',
}

export default async function Home() {
  /* Closed rooms are excluded here — they never get a pin. Seasonal rooms ARE
     fetched, because the panel toggle restores them; inRoster() on the client
     keeps them off by default. */
  const { data } = await supabase
    .from('rooms')
    /* One string literal, not a concatenation: `'a' + 'b'` widens to `string`
       and supabase-js can then only infer GenericStringError, which a cast
       would hide rather than fix. */
    .select(
      'slug,name,area,status,is_seasonal,latitude,longitude,table_count,verified_at,cash_games(game,stakes_label,big_blind)',
    )
    .neq('status', 'closed')
    .order('name')

  const rooms: MapRoom[] = (data ?? []).map((r) => {
    const games = r.cash_games as Array<{ game: string; stakes_label: string; big_blind: number | null }>
    const nlh = games
      .filter((g) => g.game === 'nlh' && g.big_blind != null)
      .sort((a, b) => Number(a.big_blind) - Number(b.big_blind))
    return {
      slug: r.slug,
      name: r.name,
      area: r.area,
      status: r.status,
      is_seasonal: r.is_seasonal,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      table_count: r.table_count,
      verified_at: r.verified_at,
      games: [...new Set(games.map((g) => GAME_KEY[g.game]).filter(Boolean))],
      stakes: nlh.length
        ? nlh.length > 1
          ? `${nlh[0].stakes_label} – ${nlh[nlh.length - 1].stakes_label}`
          : nlh[0].stakes_label
        : null,
    }
  })

  return <MapClient rooms={rooms} />
}
