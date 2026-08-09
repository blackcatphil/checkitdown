import { comboKey, comboSort, roomCombos } from '@/lib/stakes-filter'
import { MapClient } from './MapClient'
import type { MapRoom } from './MapShell'

import type { AmenityDef } from '@/lib/amenity-filter'
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
    /* STILL ONE STRING LITERAL — see the note above, and note that adding the
       amenity join is exactly how it gets broken. Splitting this across a `+`
       to fit the new columns widens the type to `string`, supabase-js falls
       back to GenericStringError, and every field access below fails to
       typecheck. `available` is the three-state's raw material (true, false,
       or NO ROW) and the absence is load-bearing — nothing here may coalesce
       it away. */
    .select(
      'slug,name,area,status,is_seasonal,latitude,longitude,table_count,verified_at,cash_games(game,stakes_label,big_blind,big_bet,spread_max),room_amenities(available,amenity_types(slug))',
    )
    .neq('status', 'closed')
    .order('name')

  /* THE CATALOGUE COMES FROM THE DATABASE, not a constant in the client.
     `amenity_types` already carries the label, the group and the sort order,
     and a second hand-maintained copy would drift the first time a label is
     reworded — with the panel and the room page then disagreeing about what
     the same slug is called. `is_filterable` is applied HERE, which is the
     answer to the note `UNFILTERED_BY_DESIGN` has been carrying: the column
     was always meant to gate this panel and had nowhere to act until now. */
  const { data: amenityDefs } = await supabase
    .from('amenity_types')
    .select('slug,label,grp,sort_order')
    .eq('is_filterable', true)
    .order('sort_order')

  const rooms: MapRoom[] = (data ?? []).map((r) => {
    const games = r.cash_games as Array<{
      game: string; stakes_label: string | null
      big_blind: number | null; big_bet: number | null; spread_max: number | null
    }>
    const rows = r.room_amenities as Array<{ available: boolean; amenity_types: { slug: string } | null }>
    /* Only answered slugs become keys. A room with no row for `freeself` must
       come out of here with no `freeself` key at all — writing `false` for it
       would erase the difference between a confirmed no and an unasked
       question at the one point where the data still knows. */
    const amenities: Record<string, boolean> = {}
    for (const a of rows) {
      if (a.amenity_types?.slug) amenities[a.amenity_types.slug] = a.available
    }
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
      /* ONE KEY PER ROW, variant and stakes together — see lib/stakes-filter.
         This is the shape that makes "$2/5 NLH matches a room that only spreads
         $2/5 PLO" impossible rather than merely unlikely. */
      combos: roomCombos(games),
      /* The label and the SORT NUMBER travel with the key so the panel never
         parses a label to order it. `$10/20` sorts after `$2/5` because 20 > 5,
         which string order would get backwards. */
      comboMeta: Object.fromEntries(
        games.filter((g) => g.stakes_label).map((g) => [
          comboKey(g.game, g.stakes_label!),
          { variant: g.game, label: g.stakes_label!, sort: comboSort(g) },
        ]),
      ),
      amenities,
      stakes: nlh.length
        ? nlh.length > 1
          ? `${nlh[0].stakes_label} – ${nlh[nlh.length - 1].stakes_label}`
          : nlh[0].stakes_label
        : null,
    }
  })

  const defs: AmenityDef[] = (amenityDefs ?? []).map((d) => ({
    slug: d.slug, label: d.label, grp: d.grp as AmenityDef['grp'], sort: d.sort_order,
  }))

  return <MapClient rooms={rooms} amenityDefs={defs} />
}
