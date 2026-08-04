import Link from 'next/link'

import { supabase } from '@/lib/supabase'

export const metadata = { title: 'Just the facts — Check It Down' }
export const revalidate = 300

type AmenityJoin = {
  detail: string | null
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
  table_count: number | null
  verified_at: string | null
  cash_games: GameJoin[]
  room_amenities: AmenityJoin[]
}

const EMDASH = '—'

/** Rake is only a claim if a source states it. `rake_type` NULL means the room
 *  publishes no figure at all — that is different from a cap with no percent. */
function rakeLabel(games: GameJoin[]): string | null {
  const priced = games.filter((g) => g.rake_type === 'pot' && g.rake_cap != null)
  if (!priced.length) return null
  const cap = Math.min(...priced.map((g) => Number(g.rake_cap)))
  const at = priced.filter((g) => Number(g.rake_cap) === cap)
  const pct = at.find((g) => g.rake_percent != null)?.rake_percent
  return pct != null ? `${Number(pct)}% to $${cap}` : `to $${cap}`
}

function dropLabel(games: GameJoin[]): string | null {
  const drops = games.map((g) => g.jackpot_drop).filter((d): d is number => d != null)
  if (!drops.length) return null
  return `$${Math.max(...drops.map(Number))}`
}

function amenityLabel(a: AmenityJoin[], groups: string[]): string | null {
  const hits = a.filter((x) => x.amenity_types && groups.includes(x.amenity_types.grp))
  if (!hits.length) return null
  return hits.map((x) => x.amenity_types!.label).join(', ')
}

/* The unverified treatment. Shown, never hidden, never quietly rounded — and
   it cannot win a ranking. */
function Cell({ value }: { value: string | null }) {
  if (value == null) {
    return (
      <span
        className="num"
        style={{ color: 'var(--cid-disabled)' }}
        title="Not yet checked on site"
      >
        {EMDASH}
      </span>
    )
  }
  return <span className="num cid-unverified" style={{ font: 'var(--cid-num)' }}>~{value}</span>
}

/**
 * The zero-verified state of a superlative card.
 *
 * This is the state that exists on day one, so it is designed rather than
 * fallen back to. It cannot render blank and it cannot show a placeholder
 * winner — the same discipline as the exclusion line: say what is missing and
 * why. The card keeps its full shape so the page reads as intentional.
 *
 * The "name the room, never a count" rule is about a hedge hiding one or two
 * exclusions. When the whole set is excluded the honest statement IS the set,
 * so it names the total and the reason rather than listing seventeen rooms.
 */
function Superlative({
  label,
  winner,
  metric,
  sourcedCount,
}: {
  label: string
  winner: { name: string; value: string } | null
  metric: string
  sourcedCount: number
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
        minHeight: 148,
      }}
    >
      <span className="cid-label">{label}</span>

      {winner ? (
        <>
          <span style={{ font: 'var(--cid-h2)', color: 'var(--cid-value)' }}>{winner.name}</span>
          <span className="num" style={{ font: 'var(--cid-num-lg)', color: 'var(--cid-text-2)' }}>
            {winner.value}
          </span>
        </>
      ) : (
        <>
          <span
            className="num"
            style={{ font: 'var(--cid-h2)', color: 'var(--cid-unverified)' }}
          >
            {EMDASH}
          </span>
          <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
            No room can be ranked on {metric} yet. All {sourcedCount} are sourced and
            none is confirmed on site, and an unverified figure is never ranked.
          </span>
        </>
      )}
    </div>
  )
}

export default async function JustTheFacts() {
  const { data, error } = await supabase
    .from('rooms')
    .select(
      'slug,name,area,table_count,verified_at,'
      + 'cash_games(rake_type,rake_percent,rake_cap,jackpot_drop,verified_at,rake_verified_at),'
      + 'room_amenities(detail,verified_at,amenity_types(slug,label,grp))',
    )
    .order('name')

  if (error) {
    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0' }}>
        <p style={{ font: 'var(--cid-body)' }}>Could not reach the database: {error.message}</p>
      </main>
    )
  }

  const rooms = (data ?? []) as unknown as RoomRow[]

  /* Verified is the ONLY thing that can be ranked. Today this is zero, which is
     exactly the state the page has to hold without looking broken. */
  const rankable = rooms.filter((r) => r.verified_at != null)

  const HEADS = ['# BY RAKE', 'ROOM', 'RAKE', 'DROP', 'PARKING', 'FOOD', 'TABLES', 'VERIFIED']

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)' }}>
      <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-4)' }}>
        Just the facts
      </h1>
      <p
        style={{
          font: 'var(--cid-lede)',
          color: 'var(--cid-text-3)',
          maxWidth: 'var(--cid-measure)',
          margin: '0 0 var(--cid-space-8)',
        }}
      >
        Every published fact we hold on {rooms.length} valley rooms, ranked cheapest rake
        first. Nothing here has been confirmed on site yet, so every figure is shown
        tilde&rsquo;d and nothing is ranked — the ranks fill in as rooms are checked.
      </p>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--cid-space-5)',
          marginBottom: 'var(--cid-space-8)',
        }}
      >
        <Superlative label="LOWEST RAKE" winner={null} metric="rake" sourcedCount={rooms.length} />
        <Superlative label="BEST FOOD" winner={null} metric="food" sourcedCount={rooms.length} />
        <Superlative label="MOST TABLES" winner={null} metric="table count" sourcedCount={rooms.length} />
      </section>

      <div style={{ border: '1px solid var(--cid-line-1)' }}>
        <div className="cid-trow cid-thead">
          {HEADS.map((h) => (
            <span
              key={h}
              className="cid-label"
              style={{ letterSpacing: 'var(--cid-track-nav)' }}
            >
              {h}
            </span>
          ))}
        </div>

        {rooms.map((r) => (
          <div className="cid-trow" key={r.slug}>
            {/* Rank belongs to a sort, and an unverified row cannot hold one. */}
            <span className="num" style={{ font: 'var(--cid-rank)', color: 'var(--cid-disabled)' }}>
              {EMDASH}
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
            <Cell value={rakeLabel(r.cash_games)} />
            <Cell value={dropLabel(r.cash_games)} />
            <Cell value={amenityLabel(r.room_amenities, ['parking'])} />
            <Cell value={amenityLabel(r.room_amenities, ['food_drink'])} />
            <Cell value={r.table_count != null ? String(r.table_count) : null} />
            <span
              className="num cid-unverified"
              style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)' }}
            >
              UNVERIFIED
            </span>
          </div>
        ))}
      </div>

      <p
        style={{
          font: 'var(--cid-caption)',
          color: 'var(--cid-dim)',
          maxWidth: 'var(--cid-measure)',
          marginTop: 'var(--cid-space-6)',
        }}
      >
        {rankable.length} of {rooms.length} rooms are confirmed on site. A dash means we have
        not checked, not that the room lacks it. Rake is the lowest published cap across the
        games a room spreads; where a room publishes a cap but no percentage, only the cap is
        shown, and where it publishes nothing at all the cell is a dash.
      </p>
    </main>
  )
}
