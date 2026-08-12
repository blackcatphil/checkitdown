import Link from 'next/link'

import { inRoster, type RosterRoom } from '@/lib/roster'
import { COVERAGE_FIELDS, coverageFor, verificationFor } from '@/lib/ledger'
import { supabase } from '@/lib/supabase'
import { whoAmI } from '@/lib/supabase-admin'

/* Never prerendered: what this shows depends on who is asking, and it is a
   working screen rather than a published one. */
export const dynamic = 'force-dynamic'

/**
 * THE ROOMS LEDGER — what we hold on each room, read from the database.
 *
 * ═══ IT READS FACTS, NOT EVENTS ═══
 *
 * Nothing on this screen comes from `analytics.events`. Sessions, outbound
 * clicks and a 7-day delta are all columns the design asks for and all of them
 * would be zero today — the events shipped this round and have run for no time
 * at all. A column of zeroes across seventeen rows does not read as "no data
 * yet", it reads as "nobody goes there", which is a claim about the rooms made
 * out of a fact about us. They are left OUT until events have a week behind
 * them, rather than shown empty.
 *
 * ═══ ⚠️ NO STATUS TAG, NO TRAFFIC LIGHT ═══
 *
 * The design carries a red/amber/green status on a 12h/48h threshold. Two
 * reasons it is not here, and the second one is the law:
 *
 *   1. IT CANNOT DISCRIMINATE ON OUR DATA. The newest verification in the whole
 *      database is 80 hours old and the oldest is around 128. Every room would
 *      sit in the worst bucket, permanently — a column that is the same colour
 *      on every row is furniture.
 *   2. COLOUR CARRIES NO DATA STATE (§6). Verified is a mark and a date. A
 *      traffic light is a data state carried by hue, which is the one thing the
 *      palette law forbids outright, and an internal screen is not exempt —
 *      that is where the habit would start.
 *
 * So verification is a count and a date, and a reader draws their own line.
 */
export default async function LedgerPage() {
  const { isAdmin } = await whoAmI()
  if (!isAdmin) {
    /* IDENTITY FIRST, DATA NEVER — the same shape /admin uses. Nothing is
       queried for a stranger, so nothing leaks through the RSC payload. */
    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)' }}>
        <span className="cid-label">LEDGER</span>
        <h1 style={{ font: 'var(--cid-statement)', margin: 0 }}>Not for you</h1>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
          This is an internal working screen. <Link href="/admin">Sign in</Link> if
          it should be.
        </p>
      </main>
    )
  }

  const { data } = await supabase
    .from('rooms')
    .select(
      'slug,name,area,status,is_seasonal,closed_on,table_count,phone,min_age,is_24h,hours_note,'
      + 'comp_rate_hourly,verified_at,'
      + 'cash_games(id,rake_cap,rake_percent,rake_verified_at),'
      + 'room_amenities(amenity_id,verified_at)',
    )
    .order('name')

  const rooms = (data ?? []) as unknown as Array<RosterRoom & Parameters<typeof coverageFor>[0] & Parameters<typeof verificationFor>[0] & {
    slug: string; name: string; area: string
  }>

  /* THE ROSTER RULE, NOT A HAND-PICKED LIST. The same predicate the map and
     every count already use, so this screen cannot disagree with the site about
     which rooms exist. */
  const roster = rooms.filter((r) => inRoster(r))

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)', display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
        <span className="cid-label">LEDGER</span>
        <h1 style={{ font: 'var(--cid-statement)', margin: 0 }}>Rooms</h1>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
          {roster.length} rooms on the roster. Every figure here is derived at
          read time from the database — nothing is stored, nothing is typed, and
          nothing on this page comes from usage events.
        </p>
      </div>

      {/* ⚠️ TWO COLUMNS, NEVER MERGED. FILLED is whether we hold a value;
          VERIFIED is whether somebody stood in the room. A single "coverage"
          number that mixed them would let a room look complete on figures
          nobody has confirmed — which is the precedence law collapsed into an
          average. */}
      <div className="cid-ledger">
        <div className="cid-ledger-row cid-ledger-head">
          <span className="cid-label">ROOM</span>
          <span className="cid-label">AREA</span>
          <span className="cid-label">FILLED</span>
          <span className="cid-label">VERIFIED</span>
        </div>
        {roster.map((r) => {
          const cov = coverageFor(r)
          const ver = verificationFor(r)
          return (
            <div key={r.slug} className="cid-ledger-row">
              <span>
                <Link href={`/rooms/${r.slug}`}>{r.name}</Link>
              </span>
              <span className="num cid-ledger-area">{r.area.replace('_', '-')}</span>

              {/* ⚠️ n/8 AND THE NAMES, NOT A PERCENTAGE AND NOT A BAR.
                  Four of the eight fields are 17/17, so the ratio cannot
                  discriminate — a percentage would sit between 62 and 100 on
                  every row and reassure without informing. The names are the
                  actionable half: "this room is missing comps and a phone" is
                  a morning's work, "75%" is not. */}
              <span className="cid-ledger-filled">
                <span className="num">{cov.filled}/{COVERAGE_FIELDS.length}</span>
                {cov.missing.length > 0 && (
                  <span className="cid-ledger-missing">
                    missing {cov.missing.join(', ')}
                  </span>
                )}
              </span>

              {/* VERIFIED IS A COUNT AND A DATE — the mark, and when. Never a
                  colour, never a tag. `rooms.verified_at` is 0/17, so the
                  room-level stamp shows the honest em-dash rather than a zero
                  that would read as a measurement. */}
              <span className="cid-ledger-verified">
                <span className="num">{ver.stamped} facts</span>
                <span className="num cid-ledger-when">
                  {ver.newest
                    ? `newest ${ver.newest.slice(0, 10)}`
                    : 'never'}
                </span>
                <span className="num cid-ledger-when">
                  room stamp {r.verified_at ? r.verified_at.slice(0, 10) : '—'}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
        FILLED counts {COVERAGE_FIELDS.length} tracked fields:{' '}
        {COVERAGE_FIELDS.map((f) => f.label).join(', ')}. Dress code, drinks,
        house rules and descriptions are deliberately outside the denominator —
        they are 0/17 across the board, so counting them would move every room
        down for a reason that is about our checking rather than the room.
      </p>
    </main>
  )
}
