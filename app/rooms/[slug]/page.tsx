import Link from 'next/link'
import { notFound } from 'next/navigation'

import { STATUS_LABEL, type RoomStatus } from '@/lib/roster'
import { coverageFrom } from '@/lib/coverage'
import type { Fact } from '@/lib/provenance'
import { PROVENANCE_COPY, provenanceState, unverifiedSources } from '@/lib/provenance'
import { hostOf, inPersonReceipt, isPrivate, type PrivateSources } from '@/lib/receipts'
import { supabase } from '@/lib/supabase'

import { CorrectionForm } from './CorrectionForm'

export const revalidate = 300

/** Straight-line km between two property centroids. A guide, not a route. */
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const EMDASH = '—'
const AREA_LABEL: Record<string, string> = {
  strip: 'Strip',
  downtown: 'Downtown',
  off_strip: 'Off-Strip',
  locals: 'Locals',
}

export async function generateStaticParams() {
  const { data } = await supabase.from('rooms').select('slug')
  return (data ?? []).map((r) => ({ slug: r.slug }))
}

/** Section shell — every block on this page can be empty, so the empty state is
 *  the shared case rather than something each block reinvents. */
function Block({
  label,
  children,
  empty,
}: {
  label: string
  children?: React.ReactNode
  empty?: React.ReactNode
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
      <span className="cid-label">{label}</span>
      {empty ?? children}
    </section>
  )
}

/**
 * An empty block has TWO states and they are not interchangeable.
 *
 *   NOT CHECKED YET  — no source, a gap in our checking
 *   CHECKED, NONE    — someone stood here and confirmed there are none
 *
 * Collapsing them reports a completed check as a gap, which is the same
 * unknown-as-negative error inverted: once a person has walked Horseshoe and
 * confirmed it has none of the twelve, "we have no source for amenities" is
 * simply false. Confirmed absence is a FACT and reads as one.
 *
 * The not-checked state is still the clearest statement of what makes this
 * product different — other guides show undated facts and let you assume they
 * are current; we show a dated gap, with the correction link turning it into an
 * input.
 */
function EmptyBlock({
  what,
  checkedAt,
  plural = true,
}: {
  what: string
  checkedAt: string | null
  /* One templated sentence cannot serve both "amenities are" and "a rake
     figure is" — the earlier version read "amenities IS the kind of thing". */
  plural?: boolean
}) {
  const checked = checkedAt != null
  return (
    <div
      style={{
        border: checked ? '1px solid var(--cid-line-2)' : '1px dotted var(--cid-unverified-rule)',
        borderRadius: 'var(--cid-r-md)',
        padding: 'var(--cid-space-6)',
        background: 'var(--cid-fill-1)',
      }}
    >
      <p style={{ font: 'var(--cid-body-strong)', color: 'var(--cid-text-2)', margin: 0 }}>
        {checked ? `Checked on site — no ${what}.` : 'Not yet checked on site.'}
      </p>
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 'var(--cid-space-2) 0 0' }}>
        {checked ? (
          <>
            Someone confirmed on {new Date(checkedAt!).toISOString().slice(0, 10)} that this
            room has no {what}. That is a finding, not a gap — the absence is the fact.
          </>
        ) : (
          <>
            We have no source for {what} at this room. That is a gap in our checking, not a
            statement that the room lacks {plural ? 'them' : 'it'} — {what}{' '}
            {plural ? 'are' : 'is'} the kind of thing a person in the room can confirm in
            seconds and no casino publishes reliably.
          </>
        )}
      </p>
    </div>
  )
}

export default async function RoomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const { data } = await supabase
    .from('rooms')
    .select(
      'id,slug,name,property,area,status,is_seasonal,closed_on,latitude,longitude,'
      + 'table_count,phone,website_url,hours_note,is_24h,'
      + 'loyalty_program,comp_rate_hourly,comp_notes,dress_code,drinks_note,'
      + 'source_url,fetched_at,verified_at,'
      + 'cash_games(stakes_label,game,min_buy_in,max_buy_in,is_uncapped,rake_type,rake_percent,'
      /* `source_url`/`verified_at` are the GAME's own provenance and are
         distinct from the rake's — the partner apply cited stakes to a doc and
         rake to the sheet on the same row. The provenance block needs both. */
      + 'rake_cap,jackpot_drop,structure_note,big_blind,big_bet,source_url,verified_at,rake_source_url,rake_verified_at),'
      + 'room_amenities(available,detail,menu_url,source_url,verified_at,amenity_types(slug,label,grp)),'
      + 'house_rules(label,value,source_url,verified_at),'
      + 'room_formats(slug,label,note,source_url,verified_at)',
    )
    .eq('slug', slug)
    .maybeSingle()

  /* WHICH SOURCES CANNOT BE LINKED, read from the sources table rather than
     matched on a URL — the next private source will be on another host. */
  const { data: privateRows } = await supabase
    .from('source_kinds').select('url').eq('data_type', 'floor')
  const priv: PrivateSources = new Set((privateRows ?? []).map((r) => r.url as string))

  /* COVERAGE IS A ROSTER QUESTION, so it is asked of the roster. Two cheap
     reads: seventeen rows of two nullable columns, and a count. */
  const [{ data: allRooms }, { count: houseRuleCount }] = await Promise.all([
    supabase.from('rooms').select('dress_code,drinks_note'),
    supabase.from('house_rules').select('*', { count: 'exact', head: true }),
  ])
  const coverage = coverageFrom(allRooms ?? [], houseRuleCount ?? 0)

  if (!data) notFound()
  const room = data as unknown as {
    id: string; slug: string; name: string; property: string | null; area: string
    status: RoomStatus; is_seasonal: boolean; closed_on: string | null
    latitude: number; longitude: number
    table_count: number | null; phone: string | null; website_url: string | null
    hours_note: string | null; loyalty_program: string | null; comp_rate_hourly: number | null
    comp_notes: string | null; dress_code: string | null; drinks_note: string | null
    source_url: string | null; fetched_at: string | null; verified_at: string | null
    cash_games: Array<{
      stakes_label: string; game: string; min_buy_in: number | null; max_buy_in: number | null
      is_uncapped: boolean; rake_type: string | null; rake_percent: number | null
      rake_cap: number | null; jackpot_drop: number | null; structure_note: string | null
      big_blind: number | null; big_bet: number | null
      source_url: string | null; verified_at: string | null
      rake_source_url: string | null; rake_verified_at: string | null
    }>
    room_amenities: Array<{
      available: boolean; detail: string | null; menu_url: string | null
      source_url: string | null; verified_at: string | null
      amenity_types: { slug: string; label: string; grp: string } | null
    }>
    house_rules: Array<{ label: string; value: string; source_url: string | null; verified_at: string | null }>
    room_formats: Array<{
      slug: string; label: string | null; note: string | null
      source_url: string | null; verified_at: string | null
    }>
  }

  /* THE COVERAGE GATE, in its smallest form — and it renders NOTHING today.
     That is the correct state, not an unfinished one, so do not delete this
     as dead code.
     Both seeded rows are `dbbp`, an abbreviation whose expansion is
     unconfirmed. We hold the fact; we cannot write the words. A NULL label
     means exactly that, and this filter is the difference between "recorded"
     and "published" — the same line `lib/coverage.ts` draws for the roster,
     drawn here per row because a format is a per-room fact.
     The moment someone confirms what dbbp stands for, a single UPDATE setting
     `label` makes this block appear on two pages. Nothing else has to be
     remembered, which is the whole point of gating on data instead of on a
     boolean somebody has to find. */
  const formats = room.room_formats.filter((f) => f.label != null)


  /* A CLOSED room keeps its page. /rooms/<slug> stays linked from search for
     months after a closure, and a 404 tells that visitor nothing — not that the
     room shut, not when, not where to go instead. So the page becomes a dated
     closure notice that answers all three. Resorts World in March 2026 is
     exactly this case. */
  if (room.status === 'closed') {
    const { data: openRooms } = await supabase
      .from('rooms')
      .select('slug,name,area,latitude,longitude,table_count')
      .eq('status', 'open')
      .eq('is_seasonal', false)
    const nearest = (openRooms ?? [])
      .map((o) => ({ ...o, km: haversineKm(room.latitude, room.longitude, o.latitude, o.longitude) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3)

    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-7)' }}>
        <header>
          <p
            className="num"
            style={{
              font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)',
              color: 'var(--cid-accent-300)', border: '1px solid var(--cid-accent-line)',
              borderRadius: 'var(--cid-r-sm)', padding: 'var(--cid-space-3) var(--cid-space-5)',
              display: 'inline-block', margin: '0 0 var(--cid-space-5)',
            }}
          >
            CLOSED{room.closed_on ? ` ${new Date(room.closed_on).toISOString().slice(0, 10)}` : ''}
          </p>
          <h1 style={{ font: 'var(--cid-h1)', margin: '0 0 var(--cid-space-4)' }}>{room.name}</h1>
          <p style={{ font: 'var(--cid-lede)', color: 'var(--cid-text-3)', maxWidth: 'var(--cid-measure)', margin: 0 }}>
            This poker room closed{room.closed_on ? ` on ${new Date(room.closed_on).toISOString().slice(0, 10)}` : ''} and
            is off the roster, so it is not counted or ranked anywhere on the site. The page
            stays up because a dead link tells you nothing — this at least tells you what
            happened and where to go instead.
          </p>
        </header>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
          <span className="cid-label">NEAREST OPEN ROOMS</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
            {nearest.map((n) => (
              <Link
                key={n.slug}
                href={`/rooms/${n.slug}`}
                style={{
                  background: 'var(--cid-ink-700)', padding: 'var(--cid-space-5)',
                  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto',
                  gap: 'var(--cid-space-5)', alignItems: 'baseline',
                  borderBottom: 'none', color: 'var(--cid-text)', minHeight: 'var(--cid-target)',
                }}
              >
                <span style={{ font: 'var(--cid-room-name)' }}>{n.name}</span>
                <span className="cid-label">{AREA_LABEL[n.area] ?? n.area}</span>
                <span className="num cid-unverified" style={{ font: 'var(--cid-num)' }}>
                  ~{n.km.toFixed(1)} km
                </span>
              </Link>
            ))}
          </div>
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            Straight-line distance from property centroid to property centroid — a guide,
            not a route. Those rooms are unverified like everything else here.
          </p>
        </section>

        <p style={{ font: 'var(--cid-body)', margin: 0 }}>
          <Link href="/facts">See every open room</Link>
        </p>
      </main>
    )
  }

  /* available=false is a CONFIRMED ABSENCE, not a listing. */
  const present = room.room_amenities.filter((a) => a.available)

  /* WHETHER THE AMENITIES WERE CHECKED IS AN AMENITY FACT, NOT A ROOM FACT.
     This gated on room.verified_at, which was indistinguishable from correct
     while the only way to verify anything was to sign off a whole room. The
     partner floor data verifies rows: Horseshoe now carries two amenity rows,
     both available=false, both confirmed on the floor — a completed check whose
     finding is "neither of these is here". Gating on the room reported that as
     a GAP, which inverts the meaning of the only real amenity data we have. */
  const amenitiesCheckedAt = room.room_amenities
    .map((a) => a.verified_at)
    .filter((v): v is string => v != null)
    .sort()
    .at(-1) ?? room.verified_at
  const games = [...room.cash_games].sort(
    (a, b) => (Number(a.big_blind ?? a.big_bet ?? 0)) - (Number(b.big_blind ?? b.big_bet ?? 0)),
  )

  /* DRESS CODE and DRINKS are 0/17 and researched to stay there — the only
     first-party dress code that exists is the Venetian's, and it governs the
     casino floor rather than the poker room. A tile that can only ever hold a
     dash teaches a reader that our dashes mean nothing, which costs more than
     the tile is worth. They reappear the moment one room has a value; the
     columns and the floor-visit checklist are untouched. */
  const facts: Array<[string, string | null]> = [
    ['TABLES', room.table_count != null ? String(room.table_count) : null],
    ['HOURS', room.hours_note],
    ['COMPS', room.comp_rate_hourly != null ? `$${Number(room.comp_rate_hourly).toFixed(2)}/hr` : null],
    ['CLUB', room.loyalty_program],
    ...(coverage.dressCode ? [['DRESS CODE', room.dress_code] as [string, string | null]] : []),
    ...(coverage.drinks ? [['DRINKS', room.drinks_note] as [string, string | null]] : []),
  ]

  /* Facts whose receipt is a private floor visit. Grouped by what was confirmed
     so the reader gets one sentence per kind of fact, each with its own date —
     rake and amenities are confirmed on separate visits soon enough. */
  const floorRake = room.cash_games.filter((g) => isPrivate(g.rake_source_url, priv) && g.rake_verified_at)
  const floorAmenities = room.room_amenities.filter((a) => isPrivate(a.source_url, priv) && a.verified_at)
  const floorReceipts: string[] = []
  if (floorRake.length) {
    floorReceipts.push(`Rake: ${inPersonReceipt(floorRake[0].rake_verified_at)}`)
  }
  if (floorAmenities.length) {
    floorReceipts.push(`Amenities: ${inPersonReceipt(floorAmenities[0].verified_at)}`)
  }

  /* EVERY FACT THE PAGE RENDERS, WITH ITS OWN RECEIPT.
     Built from what is displayed rather than from what the tables hold: the
     block describes what a reader is looking at, so a row that renders nowhere
     must not decide whether it appears. `formats` is already the label-gated
     subset and `present` the visible amenities, for exactly that reason.

     A CASH GAME IS TWO FACTS. That it is spread is confirmed by `verified_at`
     against `source_url`; the rake figures are confirmed by `rake_verified_at`
     against `rake_source_url`, and the partner apply cited those to DIFFERENT
     documents on the same row. Folding them into one would let a verified
     stakes line vouch for an unverified rake — the shape the rake-receipt split
     was introduced to prevent.

     The rake fact only exists WHEN THERE IS A FIGURE. A row that states no rake
     has nothing to confirm, and counting it as unverified would leave a
     permanent unverified remainder that no floor visit could ever clear —
     Golden Nugget's $4/8 is exactly that row today. */
  const provFacts: Fact[] = [
    { kind: 'room', verified: room.verified_at != null, sourceUrl: room.source_url },
    ...games.flatMap((g) => {
      const statesRake = g.rake_cap != null || g.rake_percent != null || g.jackpot_drop != null
      return [
        { kind: `game:${g.stakes_label}`, verified: g.verified_at != null, sourceUrl: g.source_url },
        ...(statesRake
          ? [{ kind: `rake:${g.stakes_label}`, verified: g.rake_verified_at != null, sourceUrl: g.rake_source_url }]
          : []),
      ]
    }),
    /* EVERY amenity row, not just the visible ones. A CONFIRMED ABSENCE IS A
       DISPLAYED FACT — it is what the empty AMENITIES block reports, and it is
       the whole reason that block distinguishes "checked, has none" from "not
       checked". Scoping this to `present` read Horseshoe as having nothing
       verified while the receipt directly above said "Amenities: Confirmed in
       person on 2026-08-06" — the exact contradiction this task exists to
       remove, reintroduced one line down. */
    ...room.room_amenities.map((a) => ({
      kind: `amenity:${a.amenity_types?.slug ?? '?'}`,
      verified: a.verified_at != null,
      sourceUrl: a.source_url,
    })),
    ...(coverage.houseRules
      ? room.house_rules.map((r) => ({
        kind: `rule:${r.label}`, verified: r.verified_at != null, sourceUrl: r.source_url,
      }))
      : []),
    ...formats.map((f) => ({
      kind: `format:${f.slug}`, verified: f.verified_at != null, sourceUrl: f.source_url,
    })),
  ]
  const provState = provenanceState(provFacts)
  const provSources = unverifiedSources(
    provFacts,
    (u) => isPrivate(u, priv),
    hostOf,
  )

  const notCheckedTitle = room.verified_at
    ? 'Checked on site — not published for this room'
    : 'Not yet checked on site'

  function rake(g: (typeof games)[number]) {
    if (g.rake_type == null) return null
    if (g.rake_percent != null && g.rake_cap != null) return `${Number(g.rake_percent)}% to $${Number(g.rake_cap)}`
    if (g.rake_cap != null) return `to $${Number(g.rake_cap)}`
    return null
  }

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-8)' }}>
      <header>
        {/* A room off the roster is still a real page — reachable, and labelled.
            Hiding it would read as "we don't have it". */}
        {STATUS_LABEL[room.status] && (
          <p
            className="num"
            style={{
              font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)',
              color: 'var(--cid-accent-300)', border: '1px solid var(--cid-accent-line)',
              borderRadius: 'var(--cid-r-sm)', padding: 'var(--cid-space-3) var(--cid-space-5)',
              display: 'inline-block', margin: '0 0 var(--cid-space-5)',
            }}
          >
            {STATUS_LABEL[room.status]} — SHOWN, NOT RANKED
          </p>
        )}
        <span className="cid-label">{AREA_LABEL[room.area] ?? room.area}</span>
        <h1 style={{ font: 'var(--cid-h1)', margin: 'var(--cid-space-3) 0 var(--cid-space-2)' }}>
          {room.name}
        </h1>
        {room.property && room.property !== room.name && (
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 0 }}>{room.property}</p>
        )}
        {room.verified_at ? (
          <p
            className="num"
            style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', marginTop: 'var(--cid-space-5)', display: 'inline-block', color: 'var(--cid-value)' }}
          >
            VERIFIED ON SITE {new Date(room.verified_at).toISOString().slice(0, 10)}
          </p>
        ) : (
          <p
            className="num cid-unverified"
            style={{ font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)', marginTop: 'var(--cid-space-5)', display: 'inline-block' }}
          >
            UNVERIFIED · SOURCED {room.fetched_at ? new Date(room.fetched_at).toISOString().slice(0, 10) : EMDASH}
          </p>
        )}
      </header>

      <Block label="THE FACTS">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-2)' }}>
              <span className="cid-label">{label}</span>
              {value == null ? (
                <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-disabled)' }} title={notCheckedTitle}>
                  {EMDASH}
                </span>
              ) : (
                <span className="num cid-unverified" style={{ font: 'var(--cid-num)', alignSelf: 'flex-start' }}>~{value}</span>
              )}
            </div>
          ))}
        </div>
      </Block>

      <Block
        label={`CASH GAMES · ${games.length}`}
        empty={games.length === 0 ? <EmptyBlock what="cash games" checkedAt={room.verified_at} /> : undefined}
      >
        <div style={{ border: '1px solid var(--cid-line-1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) repeat(4, minmax(0,1fr))', gap: 'var(--cid-space-4)', padding: 'var(--cid-space-4) var(--cid-space-5)', background: 'var(--cid-fill-1)', borderBottom: '1px solid var(--cid-line-2)' }}>
            {['GAME', 'MIN BUY-IN', 'MAX BUY-IN', 'RAKE', 'DROP'].map((h) => (
              <span key={h} className="cid-label">{h}</span>
            ))}
          </div>
          {games.map((g, i) => (
            <div key={`${g.stakes_label}-${i}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) repeat(4, minmax(0,1fr))', gap: 'var(--cid-space-4)', padding: 'var(--cid-space-4) var(--cid-space-5)', borderBottom: '1px solid var(--cid-line-1)', alignItems: 'center' }}>
              <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-text)' }}>
                {g.stakes_label} <span style={{ color: 'var(--cid-dim)' }}>{g.game.toUpperCase()}</span>
              </span>
              {[
                g.min_buy_in != null ? `$${Number(g.min_buy_in)}` : null,
                g.is_uncapped ? 'Uncapped' : g.max_buy_in != null ? `$${Number(g.max_buy_in)}` : null,
                rake(g),
                g.jackpot_drop != null ? `$${Number(g.jackpot_drop)}` : null,
              ].map((v, j) =>
                v == null ? (
                  <span key={j} className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-disabled)' }} title={notCheckedTitle}>{EMDASH}</span>
                ) : (
                  <span key={j} className="num cid-unverified" style={{ font: 'var(--cid-num)', justifySelf: 'start' }}>~{v}</span>
                ),
              )}
            </div>
          ))}
        </div>
      </Block>

      {/* HOUSE RULES is 0 rows across the roster and researched to stay that
          way — the only house-rules documents found were out-of-state rooms.
          While that holds, the block is not rendered and the grid collapses to
          a single column rather than leaving a hole where it used to be. The
          table, the query and the floor-visit checklist are all untouched: this
          is a display decision, and one recorded rule brings the block back. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: coverage.houseRules ? 'minmax(0,1.15fr) minmax(0,1fr)' : 'minmax(0,1fr)',
        gap: 'var(--cid-space-7)',
      }}>
        <Block
          label="AMENITIES"
          empty={present.length === 0 ? <EmptyBlock what="amenities" checkedAt={amenitiesCheckedAt} /> : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
            {present.map((a) => (
              <div key={a.amenity_types?.slug} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-4) var(--cid-space-5)', display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', gap: 'var(--cid-space-5)', alignItems: 'baseline' }}>
                <span className="cid-label">{a.amenity_types?.label}</span>
                <span className="cid-unverified" style={{ font: 'var(--cid-body)' }}>
                  {a.detail ?? 'Yes'}
                </span>
              </div>
            ))}
          </div>
        </Block>

        {coverage.houseRules && (
        <Block
          label="HOUSE RULES"
          empty={room.house_rules.length === 0 ? <EmptyBlock what="house rules" checkedAt={room.verified_at} /> : undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
            {room.house_rules.map((r) => (
              <div key={r.label} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-4) var(--cid-space-5)', display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', gap: 'var(--cid-space-5)' }}>
                <span className="cid-label">{r.label}</span>
                <span style={{ font: 'var(--cid-body)' }}>{r.value}</span>
              </div>
            ))}
          </div>
        </Block>
        )}
      </div>

      {/* FORMATS — gated on a label existing, per the note beside `formats`
          above. Renders nothing today; two rows are waiting behind a NULL. */}
      {formats.length > 0 && (
        <Block label="FORMATS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
            {formats.map((f) => (
              <div key={f.slug} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-4) var(--cid-space-5)', display: 'grid', gridTemplateColumns: '120px minmax(0,1fr)', gap: 'var(--cid-space-5)', alignItems: 'baseline' }}>
                <span className="cid-label">{f.label}</span>
                <span className={f.verified_at ? undefined : 'cid-unverified'} style={{ font: 'var(--cid-body)' }}>
                  {f.note ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </Block>
      )}

      <section style={{ borderTop: '1px solid var(--cid-line-1)', paddingTop: 'var(--cid-space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)' }}>
        {/* THE HEADER NEEDS SOMETHING UNDER IT. Two rooms — Skyline and Boulder
            Station — cite no private source at all, so a floor visit verifying
            them against published pages produces no receipt AND no remainder,
            and the header would stand alone over the correction form. That is a
            layout consequence of the all-verified state, not a reason to invent
            copy for a state that is meant to be silent. */}
        {(floorReceipts.length > 0 || provState !== 'all') && (
          <span className="cid-label">WHERE THIS CAME FROM</span>
        )}

        {/* WHAT WAS CONFIRMED COMES FIRST. The remainder sentence below opens
            with "Everything else", which only parses once the reader has been
            told what the something-else is. Printed above these receipts it did
            not merely read oddly — it denied them. */}
        {floorReceipts.length > 0 && (
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            {floorReceipts.join(' ')}
          </p>
        )}

        {/* ...AND THE REMAINDER EXPLAINS ITSELF, or does not render.
            `all` produces no sentence: with nothing unverified there is nothing
            to hold out of the rankings, and a block saying so would be noise
            that a future unverified row silently makes wrong again. */}
        {provState !== 'all' && (
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
            {PROVENANCE_COPY[provState]}
            {provSources.length > 0 && (
              <>
                {' '}
                {provSources.length === 1 ? 'Source: ' : 'Sources: '}
                {provSources.map((src, i) => (
                  <span key={src.url}>
                    {i > 0 && ', '}
                    {/* A PRIVATE SOURCE GETS WORDS, NOT A LINK — offering a URL
                        a reader cannot open is a receipt that behaves like a
                        locked door. The test is `data_type = 'floor'`, never a
                        host match: the next private source is on another host. */}
                    {src.isPrivate
                      ? 'a partner document that is not public'
                      : src.host
                        ? <a href={src.url} rel="nofollow noopener" target="_blank">{src.host}</a>
                        : 'an unnamed source'}
                  </span>
                ))}
                .
              </>
            )}
          </p>
        )}
        <CorrectionForm roomId={room.id} roomName={room.name} />
      </section>
    </main>
  )
}
