import Link from 'next/link'

import { exclusionLine, exclusions, rank, type RoomFacts } from '@/lib/ranking'
import { inRoster, isRankable, STATUS_LABEL, type RoomStatus } from '@/lib/roster'
import { supabase } from '@/lib/supabase'

export const metadata = { title: 'Just the facts — Check It Down' }
export const revalidate = 300

type AmenityJoin = {
  available: boolean
  verified_at: string | null
  amenity_types: { slug: string; label: string; grp: string } | null
}
type GameJoin = {
  rake_type: string | null
  rake_percent: number | null
  rake_cap: number | null
  jackpot_drop: number | null
  verified_at: string | null
  rake_verified_at: string | null
}
type RoomRow = {
  slug: string
  name: string
  area: string
  status: RoomStatus
  is_seasonal: boolean
  table_count: number | null
  verified_at: string | null
  cash_games: GameJoin[]
  room_amenities: AmenityJoin[]
}

const EMDASH = '—'

/** The room's headline rake: the lowest published cap across the games it
 *  spreads. `rake_type` NULL means the room publishes no figure at all, which
 *  is a different claim from a cap with no percentage. */
function headlineRake(games: GameJoin[]) {
  const priced = games.filter((g) => g.rake_type === 'pot' && g.rake_cap != null)
  if (!priced.length) return { cap: null as number | null, label: null as string | null, verified: false }
  const cap = Math.min(...priced.map((g) => Number(g.rake_cap)))
  const at = priced.filter((g) => Number(g.rake_cap) === cap)
  const pct = at.find((g) => g.rake_percent != null)?.rake_percent
  return {
    cap,
    label: pct != null ? `${Number(pct)}% to $${cap}` : `to $${cap}`,
    /* Rake ranking gates on rake_verified_at, not the row's verified_at —
       rake and stakes routinely come from different pages. */
    verified: at.some((g) => g.rake_verified_at != null),
  }
}

function dropLabel(games: GameJoin[]) {
  const drops = games.map((g) => g.jackpot_drop).filter((d): d is number => d != null)
  return drops.length ? `$${Math.max(...drops.map(Number))}` : null
}

/* available=false records a CONFIRMED ABSENCE — it must never render as a
   feature the room has. */
function amenityLabel(a: AmenityJoin[], grp: string) {
  const hits = a.filter((x) => x.available && x.amenity_types?.grp === grp)
  return hits.length ? hits.map((x) => x.amenity_types!.label).join(', ') : null
}

function Cell({ value, leader, checked }: { value: string | null; leader?: boolean; checked?: boolean }) {
  if (value == null) {
    /* On a CHECKED room a dash means the room does not publish it — not that we
       skipped it. Saying "not yet checked" there reports a completed check as a
       gap, the same conflation the exclusion buckets fix. */
    return (
      <span
        className="num"
        style={{ font: 'var(--cid-num)', color: 'var(--cid-disabled)' }}
        title={checked ? 'Checked on site — not published for this room' : 'Not yet checked on site'}
      >
        {EMDASH}
      </span>
    )
  }
  if (leader) {
    /* Teal marks the true #1. Verified, so no tilde and no dotted rule. */
    return <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-value)' }}>{value}</span>
  }
  return <span className="num cid-unverified" style={{ font: 'var(--cid-num)' }}>~{value}</span>
}

/**
 * A superlative card in every state it will actually occupy.
 *
 * The zero-verified state is not a fallback — on day one it is the only state
 * that exists, and during the floor visit the card holds a winner AND an
 * exclusion line at the same time. Both are designed here.
 */
function Superlative({
  label,
  winner,
  caption,
  exclusion,
  metric,
  total,
}: {
  label: string
  winner: { name: string; value: string } | null
  caption: string
  exclusion: string | null
  metric: string
  total: number
}) {
  return (
    <div
      style={{
        background: 'var(--cid-ink-700)',
        border: '1px solid var(--cid-line-1)',
        borderTop: `1px solid ${winner ? 'var(--cid-accent-300)' : 'var(--cid-line-2)'}`,
        padding: 'var(--cid-space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--cid-space-3)',
        minHeight: 168,
      }}
    >
      <span className="cid-label">{label}</span>

      {winner ? (
        <>
          <span style={{ font: 'var(--cid-h2)', color: 'var(--cid-value)' }}>{winner.name}</span>
          <span className="num" style={{ font: 'var(--cid-num-lg)', color: 'var(--cid-text-2)' }}>
            {winner.value}
          </span>
          <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>{caption}</span>
        </>
      ) : (
        <>
          <span className="num" style={{ font: 'var(--cid-h2)', color: 'var(--cid-unverified)' }}>{EMDASH}</span>
          <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
            No room can be ranked on {metric} yet. All {total} are sourced and none is
            confirmed on site, and an unverified figure is never ranked.
          </span>
        </>
      )}

      {exclusion && (
        <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', borderTop: '1px solid var(--cid-line-1)', paddingTop: 'var(--cid-space-3)' }}>
          {exclusion}
        </span>
      )}
    </div>
  )
}

export default async function JustTheFacts() {
  const { data, error } = await supabase
    .from('rooms')
    .select(
      'slug,name,area,status,is_seasonal,table_count,verified_at,'
      + 'cash_games(rake_type,rake_percent,rake_cap,jackpot_drop,verified_at,rake_verified_at),'
      + 'room_amenities(available,verified_at,amenity_types(slug,label,grp))',
    )
    .order('name')

  if (error) {
    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0' }}>
        <p style={{ font: 'var(--cid-body)' }}>Could not reach the database: {error.message}</p>
      </main>
    )
  }

  /* Roster filter applied in the read path, not assumed from the seed. A closed
     room is not a row here and a seasonal one is off by default. */
  const rooms = ((data ?? []) as unknown as RoomRow[]).filter(inRoster)
  const total = rooms.length

  const derived = rooms.map((r) => {
    const rk = headlineRake(r.cash_games)
    const food = r.room_amenities.filter((a) => a.available && a.amenity_types?.grp === 'food_drink')
    return {
      room: r,
      rake: rk,
      drop: dropLabel(r.cash_games),
      parking: amenityLabel(r.room_amenities, 'parking'),
      food: amenityLabel(r.room_amenities, 'food_drink'),
      foodCount: food.length,
      /* Gate on the ROOM being confirmed, not on amenity rows existing. A room
         with no food amenity is "confirmed and publishes none" — an unpublished
         exclusion — not an unverified one. Conflating the two would report a
         confirmed room as unchecked. */
      foodVerified: r.verified_at != null,
    }
  })

  /* Each superlative gates on the verification of the FACT it ranks, not on
     the room row generally. */
  const rakeFacts: RoomFacts[] = derived.map((d) => ({
    slug: d.room.slug,
    name: d.room.name,
    value: d.rake.cap,
    /* "Verified" means we have confirmed the state of this fact — INCLUDING
       confirming its absence. A room that publishes no rake has nothing for
       rake_verified_at to sit on, so it gates on the room instead. Otherwise a
       confirmed room with no rake reports as "not checked", which is false and
       would keep Horseshoe permanently in the wrong exclusion bucket. */
    verified: isRankable(d.room) && (d.rake.cap != null ? d.rake.verified : d.room.verified_at != null),
  }))
  const tableFacts: RoomFacts[] = derived.map((d) => ({
    slug: d.room.slug, name: d.room.name, value: d.room.table_count,
    verified: isRankable(d.room) && d.room.verified_at != null,
  }))
  const foodFacts: RoomFacts[] = derived.map((d) => ({
    slug: d.room.slug, name: d.room.name,
    value: d.foodCount > 0 ? d.foodCount : null, verified: isRankable(d.room) && d.foodVerified,
  }))

  const rakeRanked = rank(rakeFacts, 'asc')
  const tableRanked = rank(tableFacts, 'desc')
  const foodRanked = rank(foodFacts, 'desc')

  const rakeLeader = rakeRanked.find((r) => r.isLeader) ?? null
  const tableLeader = tableRanked.find((r) => r.isLeader) ?? null
  const foodLeader = foodRanked.find((r) => r.isLeader) ?? null

  /* The table is ranked by rake — the head says so and the order agrees. */
  const rankBySlug = new Map(rakeRanked.map((r) => [r.slug, r]))
  const bySlug = new Map(derived.map((d) => [d.room.slug, d]))
  const ordered = rakeRanked.map((r) => bySlug.get(r.slug)!)
  /* CONFIRMED and RANKABLE are different counts and must never be conflated.
     A room can be confirmed on site and still be unrankable here — Horseshoe
     publishes no rake figure at all, so it holds a verified date and a dash. */
  const confirmedCount = rooms.filter((r) => r.verified_at != null).length
  const rankedCount = rakeRanked.filter((r) => r.rank != null).length
  const confirmedNotRankable = confirmedCount - rankedCount

  const HEADS = ['# BY RAKE', 'ROOM', 'RAKE', 'DROP', 'PARKING', 'FOOD', 'TABLES', 'VERIFIED']

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)' }}>
      <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-4)' }}>Just the facts</h1>
      <p
        style={{
          font: 'var(--cid-lede)',
          color: 'var(--cid-text-3)',
          maxWidth: 'var(--cid-measure)',
          margin: '0 0 var(--cid-space-8)',
        }}
      >
        Every published fact we hold on {total} valley rooms, ranked by rake with the
        cheapest first. {confirmedCount === 0
          ? 'Nothing here has been confirmed on site yet, so every figure is shown tilde’d and nothing is ranked — the ranks fill in as rooms are checked.'
          : `${confirmedCount} of ${total} rooms are confirmed on site${
              confirmedNotRankable > 0
                ? `, and ${rankedCount} of those can be ranked on rake — the rest publish no rake figure to rank`
                : ' and can be ranked'
            }. Unconfirmed rooms are shown tilde’d and sort below the ranking.`}
      </p>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--cid-space-5)',
          marginBottom: 'var(--cid-space-8)',
        }}
      >
        <Superlative
          label="LOWEST RAKE"
          metric="rake"
          total={total}
          winner={rakeLeader ? { name: rakeLeader.name, value: bySlug.get(rakeLeader.slug)!.rake.label! } : null}
          caption="Lowest published cap, cheapest first."
          exclusion={exclusionLine(exclusions(rakeFacts), 'rake figure')}
        />
        <Superlative
          label="BEST FOOD"
          metric="food"
          total={total}
          winner={foodLeader ? { name: foodLeader.name, value: bySlug.get(foodLeader.slug)!.food! } : null}
          caption="Most confirmed food and drink amenities."
          exclusion={exclusionLine(exclusions(foodFacts), 'food amenity')}
        />
        <Superlative
          label="MOST TABLES"
          metric="table count"
          total={total}
          winner={tableLeader ? { name: tableLeader.name, value: `${tableLeader.value} tables` } : null}
          caption="Most tables, largest first."
          exclusion={exclusionLine(exclusions(tableFacts), 'table count')}
        />
      </section>

      <div style={{ border: '1px solid var(--cid-line-1)' }}>
        <div className="cid-trow cid-thead">
          {HEADS.map((h) => (
            <span key={h} className="cid-label" style={{ letterSpacing: 'var(--cid-track-nav)' }}>{h}</span>
          ))}
        </div>

        {ordered.map((d) => {
          const r = d.room
          const rk = rankBySlug.get(r.slug)!
          const verified = r.verified_at != null
          return (
            <div className="cid-trow" key={r.slug}>
              <span
                className="num"
                style={{
                  font: 'var(--cid-rank)',
                  color: rk.isLeader ? 'var(--cid-value)' : rk.rank != null ? 'var(--cid-text-2)' : 'var(--cid-disabled)',
                }}
                title={rk.rank == null ? 'Not ranked — not confirmed on site' : undefined}
              >
                {rk.rank != null ? `#${rk.rank}` : EMDASH}
              </span>
              <Link
                href={`/rooms/${r.slug}`}
                style={{
                  font: 'var(--cid-room-name)',
                  color: 'var(--cid-text)',
                  borderBottom: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.name}
              </Link>
              <Cell value={d.rake.label} leader={rk.isLeader} checked={verified} />
              <Cell value={d.drop} checked={verified} />
              <Cell value={d.parking} checked={verified} />
              <Cell value={d.food} checked={verified} />
              <Cell value={r.table_count != null ? String(r.table_count) : null} checked={verified} />
              {STATUS_LABEL[r.status] ? (
                <span className="num" style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', color: 'var(--cid-accent-300)' }}>
                  {STATUS_LABEL[r.status]}
                </span>
              ) : verified ? (
                <span className="num" style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', color: 'var(--cid-text-3)' }}>
                  {new Date(r.verified_at!).toISOString().slice(0, 10)}
                </span>
              ) : (
                <span className="num cid-unverified" style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)' }}>
                  UNVERIFIED
                </span>
              )}
            </div>
          )
        })}
      </div>

      <p
        style={{
          font: 'var(--cid-caption)',
          color: 'var(--cid-dim)',
          maxWidth: 'var(--cid-measure)',
          marginTop: 'var(--cid-space-6)',
        }}
      >
        {confirmedCount} of {total} rooms are confirmed on site; {rankedCount} carry a rake
        figure that can be ranked. A dash means we have not checked, not that the room
        lacks it. Rake is the lowest published cap across the
        games a room spreads; where a room publishes a cap but no percentage, only the cap
        is shown, and where it publishes nothing at all the cell is a dash.
      </p>
    </main>
  )
}
