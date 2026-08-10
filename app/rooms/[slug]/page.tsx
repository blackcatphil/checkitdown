import Link from 'next/link'
import { notFound } from 'next/navigation'

import { STATUS_LABEL, type RoomStatus } from '@/lib/roster'
import { coverageFrom } from '@/lib/coverage'
import type { Fact } from '@/lib/provenance'
import {
  notCheckedTitle, PROVENANCE_COPY, provenanceBadge,
  provenanceState, unverifiedSources,
} from '@/lib/provenance'
import { resolveDescription } from '@/lib/description'
import { formatRake } from '@/lib/figures'
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
      + 'table_count,phone,website_url,hours_note,is_24h,min_age,'
      + 'loyalty_program,comp_rate_hourly,comp_notes,dress_code,drinks_note,'
      + 'source_url,fetched_at,verified_at,'
      + 'cash_games(stakes_label,game,min_buy_in,max_buy_in,is_uncapped,rake_type,rake_percent,'
      /* `source_url`/`verified_at` are the GAME's own provenance and are
         distinct from the rake's — the partner apply cited stakes to a doc and
         rake to the sheet on the same row. The provenance block needs both. */
      + 'rake_cap,jackpot_drop,structure_note,big_blind,big_bet,source_url,verified_at,rake_source_url,rake_verified_at),'
      + 'room_amenities(available,detail,menu_url,source_url,verified_at,amenity_types(slug,label,grp)),'
      + 'house_rules(label,value,source_url,verified_at),'
      + 'room_formats(slug,label,note,source_url,verified_at)'
      /* PROSE, fetched with everything else. `author_kind` is deliberately
         NOT selected: it is stored for content management and never rendered,
         and a column the renderer cannot see is a byline it cannot grow. */
      + ',room_descriptions(body,written_at,source_url,verified_at)',
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
    hours_note: string | null; is_24h: boolean | null; min_age: number | null
    loyalty_program: string | null; comp_rate_hourly: number | null
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

    room_descriptions: Array<{
      body: string; written_at: string
      source_url: string | null; verified_at: string | null
    }> | { body: string; written_at: string
           source_url: string | null; verified_at: string | null } | null
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
  /* PROSE. PostgREST returns a one-to-one embed as an object and a
     one-to-many as an array; `unique (room_id)` should give us the former, but
     the shape is not worth betting a crash on, so both are accepted here.
     EMPTY-SAFE BY CONSTRUCTION: no row means `desc` is null and the section
     never renders. Thirteen of seventeen rooms are in exactly that state until
     the queue delivers, and that is the shipped state, not an unfinished one. */
  const descRow = Array.isArray(room.room_descriptions)
    ? room.room_descriptions[0] ?? null
    : room.room_descriptions ?? null
  /* Resolved against the room the page already fetched — the same rows the
     grid below renders. An unresolved token withholds the whole paragraph
     rather than printing a hole; see lib/description.ts. */
  const desc = descRow == null ? null : resolveDescription(descRow.body, room)

  const games = [...room.cash_games].sort(
    (a, b) => (Number(a.big_blind ?? a.big_bet ?? 0)) - (Number(b.big_blind ?? b.big_bet ?? 0)),
  )

  /* ═══ THE FACTS: FIXED SLOTS, THE SAME NINE FOR EVERY ROOM ═══
     Phil reported two boxes in the wrong colour on a room page. They were not
     tiles with a bad background — they were the ABSENCE of tiles. The grid is
     three columns fed by a variable-length array, and a room with four facts
     leaves the last row two cells short; the container's --cid-line-1 shows
     through the gap and reads as a value nobody can identify.
     So the array stops being variable. Nine slots, three full rows, rendered
     for every room whether or not we hold the fact — which is also the honest
     shape, because a fact we have not checked is a fact about the room and
     hiding the tile hides that.

     WHY THESE NINE. Chosen by what `rooms` and `room_amenities` actually carry
     across the seventeen, not by what would be nice:

       TABLES 16/17 · HOURS 17/17 · MIN AGE 17/17     — the room
       COMPS  13/17 · CLUB  12/17 · PHONE   15/17     — the player
       FREE PARKING 13/17 · TABLESIDE FOOD 15/17 · COCKTAILS 3/17

     MIN AGE, PHONE and the 24-hour flag were already being FETCHED and never
     rendered. HOURS folds `is_24h` into `hours_note`, because "24 hours" is the
     answer to the question the tile asks and two tiles would split one fact.

     COCKTAILS IS THE WEAK ONE and it is named as such: three rooms carry the
     row, so fourteen tiles show the not-yet-checked dash. That is a real state
     this product exists to display rather than a hole — but it is the slot to
     drop if the grid should go to six. DRESS CODE and DRINKS stay out: 0/17
     with research saying they will remain so, and a tile that can only ever
     hold a dash teaches a reader that our dashes mean nothing.

     ⚠️ TWO KINDS OF EMPTY, and the grid may not conflate them — the /facts Cell
     distinction, brought here. A never-checked fact gets the em-dash. A fact
     CONFIRMED ABSENT says so, with the date somebody stood there. Caesars
     Palace carries "Checked on site — no amenities" further down this very
     page while its parking and food tiles would otherwise read as unknown; two
     statements about the same visit, disagreeing.
     The absent state is derived from `room_amenities` — the same rows `present`
     and `amenitiesCheckedAt` read — and from each row's OWN verified_at, never
     from the room's. That is the distinction the amenities block already draws:
     a completed amenity check whose finding is "neither of these is here" is a
     finding, not a gap. */
  type Slot = {
    label: string
    value: string | null
    /** Set only when the fact was CHECKED and found absent. */
    absentOn?: string | null
    /** A row-filling cell: tile background, no label, no value, no claim. */
    filler?: boolean
    /** THE STAMP THAT GOVERNS THIS FACT. Room columns ride the room's, but an
        amenity rides its OWN row's — "whether the amenities were checked is an
        amenity fact, not a room fact", which the amenities block above already
        settled. Reading the room's stamp here would tilde a figure a person
        confirmed on the floor, which is the Wynn 40-tildes error in a new
        place. */
    verifiedAt?: string | null
  }

  const amenity = (slug: string, yes: string): Slot => {
    const row = room.room_amenities.find((a) => a.amenity_types?.slug === slug)
    if (row == null) return { label: '', value: null }
    if (row.available) return { label: '', value: row.detail ?? yes, verifiedAt: row.verified_at }
    /* CONFIRMED ABSENT — but only if somebody actually confirmed it. An
       available=false row with no stamp is a claim nobody has stood behind, so
       it stays a dash rather than borrowing the room's date. */
    return { label: '', value: null, absentOn: row.verified_at }
  }
  const named = (label: string, s: Slot): Slot => ({ ...s, label })

  const hours = room.is_24h ? '24 hours' : room.hours_note

  const facts: Slot[] = [
    { label: 'TABLES', value: room.table_count != null ? String(room.table_count) : null },
    { label: 'HOURS', value: hours },
    { label: 'MIN AGE', value: room.min_age != null ? `${room.min_age}+` : null },

    { label: 'COMPS', value: room.comp_rate_hourly != null ? `$${Number(room.comp_rate_hourly).toFixed(2)}/hr` : null },
    { label: 'CLUB', value: room.loyalty_program },
    { label: 'PHONE', value: room.phone },

    named('FREE PARKING', amenity('freeself', 'Yes')),
    named('TABLESIDE FOOD', amenity('tableside', 'Yes')),
    named('COCKTAILS', amenity('cocktail', 'Yes')),

    /* THE ZERO-COVERAGE SURFACES STILL COME BACK ON THEIR OWN. Dress code and
       drinks are 0/17 and hidden, and the moment ONE room on the roster carries
       either, the tile appears for every room — the gate is roster coverage,
       not this room's value, so a reader can see that we now ask a question
       this room has not answered.
       Keeping that mechanism is why the grid pads rather than fixing its length
       at nine: a conditional slot makes the count 10 or 11, and a fixed nine
       would have deleted a tested behaviour to tidy a layout. */
    ...(coverage.dressCode ? [{ label: 'DRESS CODE', value: room.dress_code }] : []),
    ...(coverage.drinks ? [{ label: 'DRINKS', value: room.drinks_note }] : []),
  ]

  /* ═══ THE LAST ROW IS ALWAYS FULL ═══
     The orphan cells Phil saw were the grid running out mid-row: the container
     paints --cid-line-1 and the 1px gaps let it through as the grid lines, so a
     missing cell shows that line colour across a whole tile and reads as a
     value nobody can identify.
     Padding is the general fix rather than a slot count that happens to divide:
     the set above is conditional, so its length is 9, 10 or 11 depending on
     roster coverage, and any rule of the form "pick a multiple of three" breaks
     the first time a surface comes back. The pad carries the tile background
     and nothing else — it is the absence of a further fact, which is exactly
     what it looks like. */
  const COLUMNS = 3
  const pad = (COLUMNS - (facts.length % COLUMNS)) % COLUMNS
  for (let i = 0; i < pad; i++) facts.push({ label: `\u200b${i}`, value: null, filler: true })

  /* WHAT WAS CONFIRMED, one line per kind of fact, each with its own date.
     Rake, stakes and amenities are confirmed on separate visits soon enough.

     GATED ON VERIFICATION, NOT ON SOURCE PRIVACY. These read "Confirmed in
     person on ..." — a claim about whether somebody stood there, which is what
     `verified_at` records. Privacy decides whether a source gets an HREF, and
     that is settled in the sources line below. Conflating the two left three
     rooms (Orleans, Santa Fe, South Point) with floor-confirmed stakes and no
     receipt anywhere, because their stakes cite a public page.

     THE STAKES LINE IS THE ONE THAT WAS MISSING, and its absence was invisible:
     "Everything else comes from published sources" only keeps an antecedent
     while SOMETHING above it has been confirmed, and that held only because
     amenity coverage happens to reach every partly-verified room. Correct by
     accident of a different table. A room verified on stakes alone would have
     printed "Everything else" with nothing for "else" to refer to. */
  const latestOf = <T,>(rows: readonly T[], get: (r: T) => string | null): string | null =>
    rows.map(get).filter((v): v is string => v != null).sort().at(-1) ?? null

  const floorRake = room.cash_games.filter((g) => g.rake_verified_at)
  const floorStakes = room.cash_games.filter((g) => g.verified_at)
  const floorAmenities = room.room_amenities.filter((a) => a.verified_at)
  const floorReceipts: string[] = []
  if (floorStakes.length) {
    floorReceipts.push(`Games: ${inPersonReceipt(latestOf(floorStakes, (g) => g.verified_at))}`)
  }
  /* THE LATEST STAMP, not `[0]`'s. The array is in whatever order PostgREST
     returned it, so the printed date was the first row's — a date that moves
     when rows are reordered and understates the moment a second visit lands.
     `amenitiesCheckedAt` three blocks up already did this correctly. */
  if (floorRake.length) {
    floorReceipts.push(`Rake: ${inPersonReceipt(latestOf(floorRake, (g) => g.rake_verified_at))}`)
  }
  if (floorAmenities.length) {
    floorReceipts.push(`Amenities: ${inPersonReceipt(latestOf(floorAmenities, (a) => a.verified_at))}`)
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
    { kind: 'room', verifiedAt: room.verified_at, sourceUrl: room.source_url },
    ...games.flatMap((g) => {
      const statesRake = g.rake_cap != null || g.rake_percent != null || g.jackpot_drop != null
      return [
        { kind: `game:${g.stakes_label}`, verifiedAt: g.verified_at, sourceUrl: g.source_url },
        ...(statesRake
          ? [{ kind: `rake:${g.stakes_label}`, verifiedAt: g.rake_verified_at, sourceUrl: g.rake_source_url }]
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
      verifiedAt: a.verified_at,
      sourceUrl: a.source_url,
    })),
    ...(coverage.houseRules
      ? room.house_rules.map((r) => ({
        kind: `rule:${r.label}`, verifiedAt: r.verified_at, sourceUrl: r.source_url,
      }))
      : []),
    ...formats.map((f) => ({
      kind: `format:${f.slug}`, verifiedAt: f.verified_at, sourceUrl: f.source_url,
    })),
  ]
  const provState = provenanceState(provFacts)
  const badge = provenanceBadge(provState, provFacts, room.fetched_at)
  const provSources = unverifiedSources(
    provFacts,
    (u) => isPrivate(u, priv),
    hostOf,
  )

  /**
   * ONE FIGURE, WITH ITS OWN RECEIPT.
   *
   * `~` plus `cid-unverified` IS the unverified marker, so a confirmed figure
   * must not wear it — Wynn shipped 40 tildes over four in-person rake
   * receipts. The stamp passed in decides, and it is the stamp for THIS figure:
   * a game's buy-ins ride `verified_at`, its rake and drop ride
   * `rake_verified_at`, and the partner cited those to different documents on
   * one row. So a rake cell can be clean while the buy-ins beside it are
   * tilded, which looks odd until you remember it is the truth.
   *
   * A verified figure gains NO COLOUR, it only loses the marker. Teal is spent
   * on the true #1 in the ranked table and on the fully-verified badge;
   * repainting every confirmed number here would spread it until it stops
   * meaning anything. Absence of the marker is the signal.
   */
  function Figure({ value, verifiedAt }: { value: string | null; verifiedAt: string | null }) {
    if (value == null) {
      /* THE COLOUR: --cid-disabled is documented "non-text markers ONLY" and
         this dash is TEXT — it carries a claim ("we have not checked"), so it
         has to be legible. At .38 paper it measured 3.29:1 here, the same
         pre-existing AA failure /facts found at 3.31:1 and fixed the same way;
         see the placeholder in app/facts/page.tsx, which carries the full
         reasoning. ONE DECISION, TWO SITES: the same construct saying the same
         thing may not be legible on one page and not the other.

         It takes the row's quietest legible step, which recedes with a dimmed
         row and clears the floor in both states (8.65:1 at rest, 4.80:1
         dimmed). The fallback is --cid-dim because this page has no dim-row
         context to inherit from — a room page is never compare-dimmed — and an
         unresolved custom property would otherwise compute to nothing at all.

         Surfaced 2026-08-09 when room detail entered the palette probe for the
         first time. My first answer was an exemption in the probe, which would
         have frozen 3.29:1 into the gate as a rule; Phil ruled it out. An
         exemption that makes a real AA failure pass is worse than not
         measuring, because it looks like a decision. */
      return (
        <span
          className="num"
          style={{ font: 'var(--cid-num)', color: 'var(--cid-row-meta, var(--cid-dim))' }}
          title={notCheckedTitle(verifiedAt)}
        >
          {EMDASH}
        </span>
      )
    }
    if (verifiedAt != null) {
      return <span className="num" style={{ font: 'var(--cid-num)', color: 'var(--cid-text)', justifySelf: 'start', alignSelf: 'flex-start' }}>{value}</span>
    }
    return (
      <span className="num cid-unverified" style={{ font: 'var(--cid-num)', justifySelf: 'start', alignSelf: 'flex-start' }}>~{value}</span>
    )
  }

  /* THE GRID AND THE PROSE SHARE ONE FORMATTER. Reading the same row and
     formatting it two ways would satisfy "interpolate from the same query" to
     the letter and still print "10% to $8" here and "$8 cap" a paragraph
     above. See lib/figures.ts. */
  const rake = formatRake

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
        {/* THE SAME STATE THE BLOCK AT THE FOOT OF THE PAGE COMPUTES. This read
            `room.verified_at`, NULL on all seventeen rooms, so Wynn wore
            "UNVERIFIED · SOURCED" above three in-person receipts. */}
        <p
          className={badge.tone === 'unverified' ? 'num cid-unverified' : 'num'}
          style={{
            font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-nav)',
            marginTop: 'var(--cid-space-5)', display: 'inline-block',
            /* VERIFIED AND PARTIAL SEPARATE BY WEIGHT, NOT BY HUE. Both are
               full-strength ink now that --cid-value is a tombstone, so hue
               alone would have collapsed two distinct states into one
               treatment on the morning of the swap. The words already differ
               ("VERIFIED ON SITE" vs "SOME FACTS CONFIRMED ON SITE") and the
               weight makes the stronger claim look stronger. */
            ...(badge.tone === 'verified' ? { color: 'var(--cid-text)', fontWeight: 700 } : {}),
            ...(badge.tone === 'partial' ? { color: 'var(--cid-text)' } : {}),
          }}
        >
          {badge.text}
        </p>
      </header>

      {/* ═══ THE DESCRIPTION — prose, and visibly not a figure ═══

          NO BYLINE, EVER (Phil ruled 2026-08-09). A partner review and a Check
          It Down description read identically: same voice, same treatment, no
          name on either. `author_kind` is stored so that swapping one for the
          other is a content change through the queue, and it is never selected
          by this page — a column the renderer cannot see is a byline it cannot
          grow by accident.

          VISUALLY DISTINCT FROM THE FACTS, because a reader must not mistake a
          take for a sourced figure. The grid is monospaced, tiled and gridded;
          this is body text on a measure, set off by a rule. It carries no gold
          eyebrow — gold is spent on verified facts, and spending it on
          judgement would be the palette saying the opposite of the truth.

          DATED, NOT HIDDEN. The written-on date sits with the prose the way
          every figure carries its verified date. Chris's Golden Nugget review
          says "recently relocated" — true today, and dating itself within a
          year. The answer is the date, not a ban on the sentence. */}
      {desc?.publish && descRow != null && (
        <section className="cid-prose">
          {/* PARAGRAPHS, BECAUSE THE AUTHOR WROTE PARAGRAPHS. The body is stored
              with its blank-line breaks — Wynn's review is 8 of them across 428
              words — and rendering it in ONE <p> collapsed every newline to a
              space, per HTML's whitespace rules. The result was a 2359-character
              wall. Nothing was wrong with the data; the renderer was throwing
              away structure the author put in.
              SPLIT ONLY, NEVER REWRAP. The text is quoted material: this splits
              on the breaks the author typed and changes nothing else — no
              re-wrapping, no smart quotes, no ellipsis substitution, no trimming
              of anything but the blank lines used as separators. A single
              newline inside a paragraph stays inside that paragraph, because it
              is the author's line and not ours to reflow. */}
          {desc.text.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="cid-prose-body">{para}</p>
          ))}
          <p className="num cid-prose-date">
            WRITTEN {new Date(descRow.written_at).toISOString().slice(0, 10)}
          </p>
        </section>
      )}

      <Block label="THE FACTS">
        <div className="cid-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '1px', background: 'var(--cid-line-1)', border: '1px solid var(--cid-line-1)' }}>
          {facts.map((f) => (
            <div key={f.label} style={{ background: 'var(--cid-ink-700)', padding: 'var(--cid-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-2)' }}>
              {f.filler ? null : <span className="cid-label">{f.label}</span>}
              {f.filler ? null : f.absentOn != null ? (
                /* CONFIRMED ABSENT. Not the dash: somebody stood here and found
                   none, and the dash means the opposite — that nobody has
                   looked. Rendered as words with the date, so the tile agrees
                   with the amenities block further down the same page instead
                   of contradicting it.
                   NOT `num`, because "None" is not a figure, and no colour,
                   because a confirmed absence is an ordinary fact rather than a
                   warning. */
                <span
                  style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)' }}
                  title={`Checked on site on ${new Date(f.absentOn).toISOString().slice(0, 10)} — this room has none`}
                >
                  None
                  <span className="num" style={{ font: 'var(--cid-caption)', color: 'var(--cid-text-3)', marginLeft: 'var(--cid-space-2)' }}>
                    {new Date(f.absentOn).toISOString().slice(0, 10)}
                  </span>
                </span>
              ) : (
                /* Room-level facts ride the ROOM's stamp — the one column that
                   legitimately governs them. An amenity slot with no row at all
                   also lands here, which is right: no row is no check. */
                <Figure value={f.value} verifiedAt={f.verifiedAt !== undefined ? f.verifiedAt : room.verified_at} />
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
              {/* THE SPLIT, cell by cell. Buy-ins are part of the stakes and
                  ride `verified_at`; rake and drop are the rake figures and
                  ride `rake_verified_at`. Golden Nugget's $4/8 is the case that
                  makes this visible: stakes confirmed, rake never stated. */}
              {[
                [g.min_buy_in != null ? `$${Number(g.min_buy_in)}` : null, g.verified_at],
                [g.is_uncapped ? 'Uncapped' : g.max_buy_in != null ? `$${Number(g.max_buy_in)}` : null, g.verified_at],
                [rake(g), g.rake_verified_at],
                [g.jackpot_drop != null ? `$${Number(g.jackpot_drop)}` : null, g.rake_verified_at],
              ].map(([v, stamp], j) => (
                <Figure key={j} value={v} verifiedAt={stamp} />
              ))}
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
      <div className="cid-stack-2" style={{
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
