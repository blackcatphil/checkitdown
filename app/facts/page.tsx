import Link from 'next/link'

import { applySort, exclusionLine, exclusions, leaders, type Ranked, type RoomFacts, type SortSpec } from '@/lib/ranking'
import { inPersonReceipt, isPrivate, type PrivateSources } from '@/lib/receipts'
import { inRoster, isRankable, STATUS_LABEL, type RoomStatus } from '@/lib/roster'
import { supabase } from '@/lib/supabase'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string }>
}) {
  const sp = await searchParams
  const personalised = Boolean((sp.compare ?? '').split(',').filter(Boolean).length)
  return {
    title: 'Just the facts — Check It Down',
    alternates: { canonical: '/facts' },
    robots: personalised ? { index: false, follow: true } : undefined,
  }
}
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
  rake_source_url: string | null
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
    /* "~to $6" is not English. A cap with no published percentage reads as
       "cap ~$6"; the tilde sits on the NUMBER, which is what it qualifies. */
    label: pct != null ? `${Number(pct)}% to $${cap}` : `cap $${cap}`,
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

/**
 * The tilde means "approximate quantity". On a string like "Cocktail service"
 * it reads as a typo, so it is scoped to numerics; an unverified string carries
 * the dotted rule alone, which already says unverified.
 */
function Cell({
  value, leader, checked, numeric = true,
}: { value: string | null; leader?: boolean; checked?: boolean; numeric?: boolean }) {
  if (value == null) {
    /* On a CHECKED room a dash means the room does not publish it — not that we
       skipped it. Saying "not yet checked" there reports a completed check as a
       gap, the same conflation the exclusion buckets fix.

       THE COLOUR: --cid-disabled is documented "non-text markers ONLY" and this
       dash is TEXT — it carries a claim ("we have not checked"), so it has to be
       legible. At .38 paper it measured 3.31:1, and 3.36:1 BEFORE the palette
       swap: a pre-existing AA failure no audit had ever looked at, surfaced by
       the new contrast gate rather than caused by the new palette. It now takes
       the row's quietest legible step, which recedes with a dimmed row and
       clears the floor in both states (8.65:1 at rest, 4.80:1 dimmed). */
    return (
      <span
        className="num"
        style={{ font: 'var(--cid-num)', color: 'var(--cid-row-meta, var(--cid-dim))' }}
        title={checked ? 'Checked on site — not published for this room' : 'Not yet checked on site'}
      >
        {EMDASH}
      </span>
    )
  }
  if (leader) {
    /* FULL-STRENGTH INK MARKS THE TRUE #1 — no colour claim, by law. This was
       teal, and the sentence here said so; the token it read is now a tombstone
       resolving to --cid-text, so the figure lands as emphasis. The weight and
       size half of the #1 treatment rides the RANK cell, where a reader looks
       first. Verified, so no tilde and no dotted rule. */
    return <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-row-lead)' }}>{value}</span>
  }
  return (
    <span
      className={numeric ? 'num cid-unverified' : 'cid-unverified'}
      style={{ font: numeric ? 'var(--cid-num)' : 'var(--cid-caption)' }}
    >
      {numeric ? `~${value}` : value}
    </span>
  )
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
          {/* Emphasis, not a colour claim — --cid-value is a tombstone now. */}
          <span style={{ font: 'var(--cid-h2)', color: 'var(--cid-text)' }}>{winner.name}</span>
          <span className="num" style={{ font: 'var(--cid-num-lg)', color: 'var(--cid-text-2)' }}>
            {winner.value}
          </span>
          <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>{caption}</span>
        </>
      ) : (
        <>
          <span className="num" style={{ font: 'var(--cid-h2)', color: 'var(--cid-unverified)' }}>{EMDASH}</span>
          {/* ONE line. The screen's job is "the best is obvious"; three copies of
              the same two paragraphs bury it. The explanation lives once, below
              the row — and only collapses there when all three cards would say
              the same thing. */}
          <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
            Nothing rankable on {metric} yet
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

export default async function JustTheFacts({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string }>
}) {
  const sp = await searchParams
  /* URL is the source of truth for shareable state. A non-empty set is a
     personalised view, so it is noindex,follow with a canonical back to the
     clean path — a crawlable ?compare= permutation would mint unbounded thin
     duplicates of one page. */
  const compare = (sp.compare ?? '').split(',').filter(Boolean)
  const compareSet = new Set(compare)
  const { data, error } = await supabase
    .from('rooms')
    .select(
      'slug,name,area,status,is_seasonal,table_count,verified_at,'
      + 'cash_games(rake_type,rake_percent,rake_cap,jackpot_drop,verified_at,rake_verified_at,rake_source_url),'
      + 'room_amenities(available,verified_at,amenity_types(slug,label,grp))',
    )
    .order('name')

  /* Sources that must never be rendered as a link, identified by data_type. */
  const { data: privateRows } = await supabase
    .from('source_kinds').select('url').eq('data_type', 'floor')
  const priv: PrivateSources = new Set((privateRows ?? []).map((r) => r.url as string))

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
  /* Kept: eslint reported this unused, the compiler disagreed in three places.
     The type checker is the authority on whether an identifier is read. */
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
      /* A rake figure confirmed by someone at the table, on a source a reader
         cannot open. It gets stated, never linked. */
      rakeInPerson: r.cash_games.find((g) => isPrivate(g.rake_source_url, priv) && g.rake_verified_at)
        ?.rake_verified_at ?? null,
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

  /* One spec per sort: head, caption and comparator all derive from it, so a
     caption can no longer describe a formula the comparator abandoned. */
  const RAKE: SortSpec = { key: 'rake', metric: 'Lowest published rake cap', direction: 'asc' }
  const TABLES: SortSpec = { key: 'tables', metric: 'Table count', direction: 'desc' }
  const FOOD: SortSpec = { key: 'food', metric: 'Confirmed food and drink amenities', direction: 'desc' }

  const rake = applySort(rakeFacts, RAKE)
  const tables = applySort(tableFacts, TABLES)
  const food = applySort(foodFacts, FOOD)
  const rakeRanked = rake.ranked
  const tableRanked = tables.ranked
  const foodRanked = food.ranked

  /* A TIE IS AN ANSWER. These were `.find(isLeader)`, which crowned whichever
     tied room happened to sort first. */
  const rakeLeader = leaders(rakeRanked)
  const tableLeader = leaders(tableRanked)
  const foodLeader = leaders(foodRanked)
  const leadValue = (l: ReturnType<typeof leaders>, ranked: Ranked[]) =>
    l ? ranked.find((r) => r.name === l.names[0])! : null

  /* The table is ranked by rake — the head says so and the order agrees. */
  const rankBySlug = new Map(rakeRanked.map((r) => [r.slug, r]))
  const bySlug = new Map(derived.map((d) => [d.room.slug, d]))
  const ordered = rakeRanked.map((r) => bySlug.get(r.slug)!)
  /* CONFIRMED and RANKABLE are different counts and must never be conflated.
     A room can be confirmed on site and still be unrankable here — Horseshoe
     publishes no rake figure at all, so it holds a verified date and a dash. */
  const confirmedCount = rooms.filter((r) => r.verified_at != null).length
  const rankedCount = rakeRanked.filter((r) => r.rank != null).length
  /* COUNT THE OVERLAP, DO NOT SUBTRACT THE TOTALS.
     This was `confirmedCount - rankedCount`, which compares two different
     populations: rake ranking is ROW-level (rake_verified_at) and confirmation
     is ROOM-level (verified_at), so a room can rank without being confirmed and
     vice versa. With fifteen rooms confirmed the subtraction read zero — while
     Horseshoe sat confirmed and unrankable and an unconfirmed room ranked in its
     place. Two errors cancelling is not agreement. */
  const rankedSlugSet = new Set(rakeRanked.filter((r) => r.rank != null).map((r) => r.slug))
  const confirmedRanked = rooms.filter((r) => r.verified_at != null && rankedSlugSet.has(r.slug)).length
  const confirmedNotRankable = confirmedCount - confirmedRanked

  /* If all three cards would print the same exclusion, print it once. They
     diverge as verification lands — rake, food and tables get confirmed at
     different times — so this collapses only while they genuinely agree. */
  const exRake = exclusionLine(exclusions(rakeFacts), 'rake figure')
  const exFood = exclusionLine(exclusions(foodFacts), 'food amenity')
  const exTables = exclusionLine(exclusions(tableFacts), 'table count')
  const sharedExclusion = exRake && exRake === exFood && exRake === exTables ? exRake : null

  const HEADS = [rake.head, 'ROOM', 'RAKE', 'DROP', 'PARKING', 'FOOD', 'TABLES', 'VERIFIED']

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
        {/* THE LEDE DESCRIBES THE TABLE UNDER IT, and the two are computed from
            different things: ranking gates on rake_verified_at per ROW, the
            confirmed count on verified_at per ROOM. Branching the whole
            sentence on the room count printed "nothing is ranked" directly
            above five ranked rows the moment partner floor data landed —
            rake figures confirmed by someone standing at the table, in rooms
            not yet signed off as a whole. Each clause now reports its own
            number. */}
        Every published fact we hold on {total} valley rooms, ranked by rake with the
        cheapest first. {rankedCount === 0
          ? 'No rake figure has been confirmed on site yet, so every figure is shown tilde’d and nothing is ranked — the ranks fill in as rooms are checked.'
          : `${rankedCount} of ${total} rake figures are confirmed on site and ranked; the rest are shown tilde’d and sort below the ranking.`}
        {' '}
        {confirmedCount === 0
          ? 'No room has been checked end to end yet.'
          : `${confirmedCount} of ${total} rooms are confirmed on site${
              confirmedNotRankable > 0
                ? `, and ${confirmedRanked} of those can be ranked on rake — the rest publish no rake figure to rank`
                : ''
            }.`}
      </p>

      {compareSet.size > 0 && (
        <p
          style={{
            font: 'var(--cid-caption)', color: 'var(--cid-dim)',
            border: '1px solid var(--cid-line-2)', borderRadius: 'var(--cid-r-md)',
            padding: 'var(--cid-space-5)', maxWidth: 'var(--cid-measure)',
            margin: '0 0 var(--cid-space-7)',
          }}
        >
          Showing your {compareSet.size}-room shortlist lit and the rest dimmed. Nothing is
          reordered and no rank is renumbered — the numbers are citywide positions, which is
          the point of a shortlist. <Link href="/facts">Clear</Link>
        </p>
      )}

      <section
        className="cid-super"
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
          winner={rakeLeader
            ? { name: rakeLeader.label, value: bySlug.get(leadValue(rakeLeader, rakeRanked)!.slug)!.rake.label! }
            : null}
          caption={rake.caption}
          exclusion={sharedExclusion ? null : exRake}
        />
        <Superlative
          label="BEST FOOD"
          metric="food"
          total={total}
          winner={foodLeader
            ? { name: foodLeader.label, value: bySlug.get(leadValue(foodLeader, foodRanked)!.slug)!.food! }
            : null}
          caption={food.caption}
          exclusion={sharedExclusion ? null : exFood}
        />
        <Superlative
          label="MOST TABLES"
          metric="table count"
          total={total}
          winner={tableLeader
            ? { name: tableLeader.label, value: `${leadValue(tableLeader, tableRanked)!.value} tables` }
            : null}
          caption={tables.caption}
          exclusion={sharedExclusion ? null : exTables}
        />
      </section>

      {sharedExclusion && (
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', maxWidth: 'var(--cid-measure)', margin: '0 0 var(--cid-space-8)' }}>
          {sharedExclusion} An unverified figure is shown but never ranked, so the
          superlatives fill in as rooms are checked on site.
        </p>
      )}

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
            /* COMPARE DIMS IN PLACE AND NEVER REORDERS. The citywide rank is
               the point of the shortlist — renumbering it #1,#2,#3 would
               invent a ranking that does not exist, so the row keeps the
               position it holds in the whole city. */
            const dimmed = compareSet.size > 0 && !compareSet.has(r.slug)
            return (
            <div
              className="cid-trow"
              key={r.slug}
              /* A DATA FLAG, NOT AN OPACITY. The row restates its three ink
                 levels in CSS (see .cid-trow[data-dim]); opacity multiplied the
                 whole row against the page and put both levels below AA. */
              data-dim={dimmed ? '' : undefined}
            >
              {/* THE RANK CARRIES ITS QUALIFIER ON A CARD.
                  On the table the qualifier is the column head — "# BY RAKE" —
                  and the head row is hidden at phone width. A bare "#3" with no
                  head is a number attached to nothing, and rank is meaningless
                  without the sort it belongs to. So the head text rides the
                  cell and CSS reveals it only where the header is gone. */}
              <span className="cid-cell" data-lead data-h={rake.head}>
                {/* THE TRUE #1 IS WEIGHT, SIZE AND FULL-STRENGTH INK — three
                    carriers, none of them hue, so the lead survives greyscale,
                    a colour-blind reader and a dimmed row. It was one colour.
                    Peers step down on all three at once rather than only
                    fading, which is what made the old single-channel version
                    depend on the one channel the law just removed. */}
                <span
                  className="num"
                  style={{
                    fontFamily: 'var(--cid-font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: rk.isLeader ? 'var(--cid-rank-lead-weight)' : 'var(--cid-rank-peer-weight)',
                    fontSize: rk.isLeader ? 'var(--cid-rank-lead-size)' : 'var(--cid-rank-peer-size)',
                    /* Peer and unranked share an ink level, deliberately. They
                       ARE different states, but the law says no data state is
                       carried by colour — and the glyph already carries it: a
                       peer shows "#4", an unranked row shows an em-dash. The
                       unranked cell used --cid-disabled, which is documented
                       non-text-only and measured 3.31:1. */
                    color: rk.isLeader ? 'var(--cid-row-lead)' : 'var(--cid-row-meta)',
                  }}
                  title={rk.rank == null ? 'Not ranked — not confirmed on site' : undefined}
                >
                  {rk.rank != null ? `#${rk.rank}` : EMDASH}
                </span>
                <span className="cid-rank-q" aria-hidden>{rake.head.replace(/^#\s*/, '')}</span>
              </span>
              <span className="cid-cell" data-lead data-h="ROOM">
                <Link
                  href={`/rooms/${r.slug}`}
                  style={{
                    font: 'var(--cid-room-name)',
                    color: 'var(--cid-row-lead)',
                    borderBottom: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.name}
                </Link>
              </span>
              <span className="cid-cell" data-h="RAKE"><Cell value={d.rake.label} leader={rk.isLeader} checked={verified} /></span>
              <span className="cid-cell" data-h="DROP"><Cell value={d.drop} checked={verified} /></span>
              <span className="cid-cell" data-h="PARKING"><Cell value={d.parking} checked={verified} numeric={false} /></span>
              <span className="cid-cell" data-h="FOOD"><Cell value={d.food} checked={verified} numeric={false} /></span>
              <span className="cid-cell" data-h="TABLES"><Cell value={r.table_count != null ? String(r.table_count) : null} checked={verified} /></span>
              <span className="cid-cell" data-h="VERIFIED">
              {STATUS_LABEL[r.status] ? (
                <span className="num" style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', color: 'var(--cid-accent-300)' }}>
                  {STATUS_LABEL[r.status]}
                </span>
              ) : verified ? (
                <span className="num" style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', color: 'var(--cid-row-meta)' }}>
                  {new Date(r.verified_at!).toISOString().slice(0, 10)}
                </span>
              ) : d.rakeInPerson ? (
                /* CONFIRMED IN PERSON, NO LINK. The room is not signed off end
                   to end, but its rake was read off the board by a person — and
                   the source behind it is private, so the receipt is words. */
                <span
                  className="num"
                  style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', color: 'var(--cid-row-meta)' }}
                  title={inPersonReceipt(d.rakeInPerson)}
                >
                  IN PERSON {new Date(d.rakeInPerson).toISOString().slice(0, 10)}
                </span>
              ) : (
                <span className="num cid-unverified" style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)' }}>
                  UNVERIFIED
                </span>
              )}
              </span>
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
