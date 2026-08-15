import Link from 'next/link'

import {
  cellFor, composite, diagnoseOverdue, isFault, render, type Cell,
} from '@/lib/growth-absence'
import { COVERAGE_FIELDS, coverageFor, verificationFor } from '@/lib/ledger'
import { inRoster, type RosterRoom } from '@/lib/roster'
import { readRollup, REVENUE_PER_CLICK, SPEC, type Rollup, type Week } from '@/lib/growth'
import { roomEventCounts } from '@/lib/growth-rooms'
import { supabase } from '@/lib/supabase'
import { whoAmI } from '@/lib/supabase-admin'

import './growth.css'

/* Never prerendered: it depends on who is asking and on a roll-up that moves. */
export const dynamic = 'force-dynamic'

const TABS = ['engine', 'loops', 'rooms', 'tests', 'spec'] as const

/** The one function every cell goes through. Typed so no tab can bypass it. */
type Metric = (producer: boolean, weeksNeeded: number, value: number | null, missing?: string) => Cell
type Tab = (typeof TABS)[number]

/**
 * THE GROWTH CONSOLE.
 *
 * ⚠️ NO SYNTHETIC ANYTHING. Every figure is a query or an absence. Where a
 * producer does not exist the cell is an em-dash; where one exists and has
 * measured nothing it is 0; where one exists and no complete week has elapsed
 * it is a DATE. `lib/growth-absence.ts` is the only thing allowed to decide
 * which, and `lib/growth-absence.test.mjs` fails if any of the three is
 * rendered as another.
 *
 * ⚠️ MODERNIST, AND ONLY MODERNIST. The design bundle landed on 2026-08-15 at
 * `docs/design/growth-engine/`, so the skin IS applied — this comment used to
 * say the system was not in the repo, which stopped being true the moment it
 * arrived. Every value comes from that `styles.css`, scoped to `.ge` in
 * `growth.css`, and nothing here may reach for a `--cid-*` token: the site's
 * system and this one are different palettes, and one gold label inside a
 * Modernist page is how a retired palette survives. `lib/modernist.test.mjs`
 * fails the build if a `cid-` class or token appears in either file.
 */
export default async function Growth({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { isAdmin } = await whoAmI()
  if (!isAdmin) {
    /* Identity first, data never — the same shape /admin/ledger uses. Nothing
       is queried for a stranger, so nothing leaks through the RSC payload.

       ⚠️ MODERNIST, NOT THE SITE SYSTEM — this block used `.cid-page`,
       `.cid-label` and five inline `--cid-*` tokens, so a stranger met a
       half-skinned page and the console's own labels rendered in the site's
       GOLD inside a Modernist screen. See the leak note in growth.css. */
    return (
      <main className="ge">
        <span className="ge-kicker">GROWTH</span>
        <h1 className="ge-h1">Not for you</h1>
        <p className="ge-copy">
          This is an internal working screen. <Link href="/admin">Sign in</Link> if it should be.
        </p>
      </main>
    )
  }

  const q = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(q.tab ?? '') ? (q.tab as Tab) : 'engine'
  const rollup = await readRollup()
  const now = new Date()

  /** Every metric goes through here. Nothing formats a number by hand. */
  /* ⚠️ AN OVERDUE CELL MUST NAME WHICH FAULT. Without this, 17 August reads
     OVERDUE because nothing refreshes the matview and somebody spends a day
     debugging a producer that is working. See diagnoseOverdue. */
  const overdueReason = diagnoseOverdue({
    refreshedAt: rollup.refreshedAt, latestEvent: rollup.latestEvent, now,
  })
  const metric: Metric = (
    producer: boolean, weeksNeeded: number, value: number | null, missing?: string,
  ): Cell => cellFor({
    producer,
    missing: missing ?? (producer ? overdueReason : undefined),
    earliestEvent: rollup.earliestEvent,
    completeWeeks: rollup.complete.length,
    weeksNeeded,
    value,
    now,
  })

  const week = rollup.complete.at(-1) ?? null
  const prior = rollup.complete.at(-2) ?? null

  return (
    <main className="ge">
      <header className="ge-head">
        <div>
          <span className="ge-kicker">GROWTH ENGINE</span>
          <h1 className="ge-h1">Console</h1>
        </div>
        <div className="ge-asof">
          {/* ⚠️ A DASHBOARD THAT DOES NOT STATE ITS AGE IS READ AS LIVE. */}
          {rollup.unreachable
            ? <span className="ge-fault">THE ROLL-UP COULD NOT BE READ</span>
            : `roll-up refreshed ${rollup.refreshedAt?.toISOString().replace('T', ' ').slice(0, 16) ?? 'never'}`}
        </div>
      </header>

      <nav className="ge-tabs">
        {TABS.map((t) => (
          <Link key={t} href={`/admin/growth?tab=${t}`}
            className={t === tab ? 'ge-tab ge-tab-on' : 'ge-tab'}>
            {t.toUpperCase()}
          </Link>
        ))}
      </nav>

      {/* ⚠️ UNREACHABLE IS A FAULT, NOT AN ABSENCE. Without this every cell
          below would read as an em-dash, which is indistinguishable from "no
          producer exists" — the confusion this console is built to prevent. */}
      {rollup.unreachable && (
        <p className="ge-fault-box">
          The weekly roll-up could not be read. Every figure below is unavailable for
          that reason, which is NOT the same as a metric having no producer. Check
          CID_EVENTS_DATABASE_URL and that migration 021 has been applied.
        </p>
      )}

      {tab === 'engine' && <Engine {...{ rollup, week, prior, metric }} />}
      {tab === 'loops' && <Loops {...{ metric, week }} />}
      {tab === 'rooms' && <Rooms metric={metric} q={q} />}
      {tab === 'tests' && <Tests />}
      {tab === 'spec' && <Spec />}
    </main>
  )
}

/**
 * One figure, rendered by the rule and never by hand.
 *
 * ⚠️ `format` TOUCHES THE NUMBER CASE ONLY. A rate has to read as `22.6%`, but
 * routing the absences through a formatter would let a caller decide how an
 * em-dash looks — and the whole point of `render` is that no caller decides
 * that. So the absent, pending and overdue states still go through `render`
 * verbatim; `format` is reached only once a number exists.
 */
function Fig({ label, cell, note, format }:
  { label: string; cell: Cell; note?: string; format?: (n: number) => string }) {
  return (
    <div className={isFault(cell) ? 'ge-fig ge-fig-fault' : 'ge-fig'}>
      <span className="ge-fig-label">{label}</span>
      <span className={cell.kind === 'number' ? 'ge-fig-value num' : 'ge-fig-absent'}>
        {cell.kind === 'number' && format ? format(cell.value) : render(cell)}
      </span>
      {cell.kind === 'no-producer' && <span className="ge-fig-why">{cell.missing}</span>}
      {cell.kind === 'overdue' && <span className="ge-fig-why">{cell.missing}</span>}
      {note && <span className="ge-fig-why">{note}</span>}
    </div>
  )
}

/** A metric cell inside the equation grid. Same rule, different frame. */
function EqCell({ label, cell, note, format, last }:
  { label: string; cell: Cell; note?: string; format?: (n: number) => string; last?: boolean }) {
  return (
    <div className={`ge-eq-cell${last ? ' ge-eq-cell-last' : ''}${isFault(cell) ? ' ge-fig-fault' : ''}`}>
      <span className="ge-fig-label">{label}</span>
      <span className={cell.kind === 'number' ? 'ge-eq-value num' : 'ge-fig-absent'}>
        {cell.kind === 'number' && format ? format(cell.value) : render(cell)}
      </span>
      {(cell.kind === 'no-producer' || cell.kind === 'overdue')
        && <span className="ge-fig-why">{cell.missing}</span>}
      {note && <span className="ge-fig-why">{note}</span>}
    </div>
  )
}

function Engine({ rollup, week, prior, metric }:
  { rollup: Rollup; week: Week | null; prior: Week | null; metric: Metric }) {
  const wap = metric(true, 1, week?.weekly_active_people ?? null)
  const reach = metric(true, 1, week?.new_reach ?? null)
  const activated = metric(true, 1, week?.activated ?? null)
  const returned = metric(true, 2, prior ? (week?.returned_from_prior ?? null) : null)
  const outbound = metric(true, 1, week?.outbound_clicks ?? null)

  /* ⚠️ COMPOSITE: LOOP GAIN TAKES THE WEAKEST INPUT. Nothing fires
     share_link_copy — migration 017 refused to create an event with no
     producer — so the share term is absent and the gain is UNKNOWN, not lower.
     Averaging over the missing term would invent a number. */
  const share: Cell = { kind: 'no-producer', missing: 'nothing fires share_link_copy' }
  const gain = composite([wap, reach, share], (v) => v[1] / Math.max(v[0], 1))

  const rate = REVENUE_PER_CLICK
  const revenue: Cell = rate === null
    ? { kind: 'no-producer', missing: 'no per-click rate set — no room pays for a click yet' }
    : composite([outbound], (v) => v[0] * rate)

  /**
   * ⚠️ THE DESIGN'S EQUATION IS NOT OUR ARITHMETIC, AND PORTING IT WOULD LIE.
   *
   * The prototype reads `New reach × Activation = New active`. Our roll-up has
   * no such identity: `new_reach` counts devices whose FIRST EVER sighting is
   * this week, and `activated` counts devices that reached an outbound click —
   * so multiplying one by a rate does not produce the other, and a grid that
   * put an `=` between them would be false in a shape that reads as proof.
   *
   * These two rows ARE exact, by construction in migration 021:
   *   weekly_active_people × (activated ÷ weekly_active_people)      = activated
   *   prior_week_active    × (returned_from_prior ÷ prior_week_active) = returned
   * Same geometry, our arithmetic. Port geometry, never a cell.
   */
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`

  /* A rate needs a denominator. When the denominator is a MEASURED ZERO the
     rate does not exist — it is not 0%, and saying 0% would report that nobody
     activates when in fact nobody was there. The why-line carries the cause so
     this em-dash is not mistaken for a missing producer. */
  const rateOf = (num: Cell, den: Cell, why: string): Cell =>
    den.kind === 'number' && den.value === 0
      ? { kind: 'no-producer', missing: why }
      : composite([num, den], (v) => v[0] / v[1])

  const activation = rateOf(activated, wap,
    'no devices were active in this week, so there is no rate to take')
  const priorActive = metric(true, 2, week?.prior_week_active ?? null)
  const returnRate = rateOf(returned, priorActive,
    'nobody was active in the prior week, so there is no rate to take')

  return (
    <section className="ge-section">
      <h2 className="ge-h2">The equation</h2>
      <p className="ge-copy">
        Every term below is a query against the weekly roll-up; none is typed. The two
        rows are identities, not estimates — the rate is the product divided by the
        stock, so the row is true by construction rather than by assumption.
      </p>

      <div className="ge-eq">
        <EqCell label="WEEKLY ACTIVE PEOPLE" cell={wap}
          note="distinct devices that reached a decision surface" />
        <div className="ge-eq-op" aria-hidden="true">×</div>
        <EqCell label="ACTIVATION" cell={activation} format={pct}
          note="of those, the share that left for a room's own document" />
        <div className="ge-eq-op" aria-hidden="true">=</div>
        <EqCell label="ACTIVATED" cell={activated} last
          note="devices, not clicks — one busy reader is not ten" />
      </div>
      <div className="ge-eq ge-eq-last">
        <EqCell label="PRIOR-WEEK ACTIVE" cell={priorActive}
          note="the denominator, carried by the roll-up so nothing computes across rows" />
        <div className="ge-eq-op" aria-hidden="true">×</div>
        <EqCell label="7-DAY RETURN" cell={returnRate} format={pct}
          note="active this week and active the week before" />
        <div className="ge-eq-op" aria-hidden="true">=</div>
        <EqCell label="RETURNED" cell={returned} last
          note="the count the rate is taken from" />
      </div>

      {/* Four cells, four columns. */}
      <div className="ge-figs">
        <Fig label="NEW REACH" cell={reach} note="first ever sighting, and a decision in the same week" />
        <Fig label="OUTBOUND CLICKS" cell={outbound} note="events, not devices" />
        <Fig label="LOOP GAIN" cell={gain} />
        <Fig label="REVENUE" cell={revenue} />
      </div>

      <h2 className="ge-h2">Weeks held</h2>
      {rollup.weeks.length === 0
        ? <p className="ge-copy">No weeks yet.</p>
        : (
          <table className="ge-table">
            <thead>
              <tr><th>WEEK</th><th>COMPLETE</th><th className="num">WAP</th>
                <th className="num">NEW</th><th className="num">ACTIVATED</th>
                <th className="num">RETURNED</th><th className="num">OUTBOUND</th></tr>
            </thead>
            <tbody>
              {rollup.weeks.map((w) => (
                <tr key={w.iso_week}>
                  <td className="num">{w.iso_week}</td>
                  <td>{w.is_complete ? 'yes' : 'in progress'}</td>
                  {/* ⚠️ AN INCOMPLETE WEEK IS NEVER PRESENTED AS A READING. Its
                      counts are shown so the page is not a lie by omission, but
                      the figures above read from complete weeks only. */}
                  <td className="num">{w.weekly_active_people}</td>
                  <td className="num">{w.new_reach}</td>
                  <td className="num">{w.activated}</td>
                  <td className="num">{w.returned_from_prior}</td>
                  <td className="num">{w.outbound_clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h2 className="ge-h2">This week&rsquo;s read</h2>
      {/* ⚠️ WRITTEN COPY, LEFT BLANK. Generating prose about numbers that do not
          exist yet would be the same invention as a synthetic metric. */}
      <p className="ge-copy ge-empty">Not written yet.</p>
    </section>
  )
}

async function Loops({ metric, week }: { metric: Metric; week: Week | null }) {
  /* ⚠️ THE STEP CHAINS AND CONSTRAINTS ARE DESIGN COPY — Phil's analysis, not a
     measurement, and labelled as such. The GAIN and the STATS beside each are
     queries or declared absences; nothing between them is estimated.

     ⚠️ AND THE STEPS ARE SPLIT FROM THAT SAME COPY, not authored here. The
     prototype gives each loop five steps with a gating RATE on each — those
     rates are invented (readme.md:35) and none of ours is measured, so the
     step cells carry the stage and nothing else. A rate slot filled with a
     plausible number is the one thing this console exists to refuse. */
  const [{ count: pending }, { count: approved }, { data: rows }] = await Promise.all([
    supabase.from('pending_changes').select('id', { count: 'exact', head: true })
      .eq('state', 'pending'),
    supabase.from('change_log').select('id', { count: 'exact', head: true }),
    supabase.from('rooms').select('slug,area,status,is_seasonal,closed_on,table_count,phone,'
      + 'min_age,is_24h,hours_note,comp_rate_hourly,verified_at,'
      + 'cash_games(id,rake_cap,rake_percent,rake_verified_at),'
      + 'room_amenities(amenity_id,verified_at)'),
  ])
  const roster = ((rows ?? []) as unknown as Array<RosterRoom
    & Parameters<typeof coverageFor>[0]>).filter((r) => inRoster(r))
  const filled = roster.reduce((n, r) => n + coverageFor(r).filled, 0)

  const num = (v: number): Cell => ({ kind: 'number', value: v })
  const none = (why: string): Cell => ({ kind: 'no-producer', missing: why })

  const LOOPS = [
    { name: 'COVERAGE', chain: 'more rooms → more search surface → more readers → more corrections',
      constraint: 'search indexing latency',
      gain: none('Search Console verified today; no history yet'),
      stats: [
        { k: 'ROOMS IN ROSTER', cell: num(roster.length) },
        { k: 'FIELDS FILLED', cell: num(filled),
          note: `of ${roster.length * COVERAGE_FIELDS.length} tracked` },
        { k: 'IMPRESSIONS', cell: none('Search Console has no history yet') },
      ] },
    { name: 'CORRECTION', chain: 'reader spots an error → submits → fact improves → more trust',
      constraint: 'one person approving the queue',
      gain: metric(true, 1, null),
      stats: [
        { k: 'PENDING IN QUEUE', cell: num(pending ?? 0) },
        { k: 'APPROVED, ALL TIME', cell: num(approved ?? 0) },
        { k: 'REPORTS THIS WEEK', cell: none('fact_report_submit is not aggregated by the weekly roll-up') },
      ] },
    { name: 'REFERRAL', chain: 'reader leaves for a room → room sees traffic → room supplies facts',
      constraint: 'no room has been shown its own number yet',
      gain: metric(true, 1, null),
      stats: [
        { k: 'OUTBOUND CLICKS', cell: metric(true, 1, week?.outbound_clicks ?? null) },
        { k: 'DEVICES THAT LEFT', cell: metric(true, 1, week?.activated ?? null) },
        { k: 'ROOMS SUPPLYING FACTS', cell: none('no room has been given a way to send one') },
      ] },
    { name: 'SHARE', chain: 'reader shares a room page → new reader arrives',
      constraint: 'there is no share affordance in the product',
      gain: none('nothing fires share_link_copy'),
      stats: [
        { k: 'SHARES', cell: none('nothing fires share_link_copy') },
        { k: 'ARRIVALS FROM A SHARE', cell: none('no share to arrive from') },
        { k: 'K-FACTOR', cell: none('needs both terms above') },
      ] },
  ]
  return (
    <section className="ge-section">
      <h2 className="ge-h2">Loops</h2>
      <p className="ge-copy">
        The chains and constraints below are analysis, not measurement. The gain beside
        each is a query.
      </p>
      {LOOPS.map((l) => (
        <div key={l.name} className="ge-loop">
          <div className="ge-loop-head">
            <span className="ge-kicker">{l.name}</span>
            <span className={l.gain.kind === 'number' ? 'ge-fig-value num' : 'ge-fig-absent'}>
              {render(l.gain)}
            </span>
          </div>
          {l.gain.kind === 'no-producer' && <p className="ge-copy ge-dim">{l.gain.missing}</p>}

          {/* The step chain, split from the copy above — grid-auto-flow column
              so every loop's steps share a row whatever their count. */}
          <div className="ge-steps">
            {l.chain.split('→').map((step, i) => (
              <div key={step} className="ge-step">
                <span className="ge-fig-label">STEP {i + 1}</span>
                <span className="ge-step-name">{step.trim()}</span>
              </div>
            ))}
          </div>

          <div className="ge-loop-stats">
            {l.stats.map((st) => (
              <div key={st.k} className="ge-stat">
                <span className="ge-fig-label">{st.k}</span>
                <span className={st.cell.kind === 'number' ? 'ge-stat-value num' : 'ge-fig-absent'}>
                  {render(st.cell)}
                </span>
                {st.cell.kind === 'no-producer' && <span className="ge-fig-why">{st.cell.missing}</span>}
                {'note' in st && st.note && <span className="ge-fig-why">{st.note}</span>}
              </div>
            ))}
            {/* The constraint sits on the surface, as the design has it. */}
            <div className="ge-stat ge-constraint">
              <span className="ge-fig-label">CONSTRAINT</span>
              <span className="ge-constraint-body">{l.constraint}</span>
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}

/**
 * ⚠️ SORT AND FILTER TRAVEL IN THE URL, NOT IN STATE.
 *
 * This is a Server Component and the roster is a query, so a client-side sort
 * would mean shipping the rows twice — once as HTML and once as JSON for the
 * sorter — and then keeping the two in step. A link per column costs nothing,
 * survives a refresh, and can be pasted to somebody else, which for a working
 * screen is the point. The prototype uses `setState` because it has no server.
 */
const AREAS = ['all', 'strip', 'downtown', 'locals'] as const
const SORTS = ['name', 'sessions', 'outbound', 'filled', 'verified'] as const
type Sort = (typeof SORTS)[number]

async function Rooms({ metric, q }:
  { metric: Metric; q: Record<string, string | undefined> }) {
  const { data } = await supabase
    .from('rooms')
    .select('slug,name,area,status,is_seasonal,closed_on,table_count,phone,min_age,is_24h,'
      + 'hours_note,comp_rate_hourly,verified_at,'
      + 'cash_games(id,rake_cap,rake_percent,rake_verified_at),'
      + 'room_amenities(amenity_id,verified_at)')
    .order('name')
  const rooms = (data ?? []) as unknown as Array<RosterRoom & Parameters<typeof coverageFor>[0]
    & Parameters<typeof verificationFor>[0] & { slug: string; name: string; area: string }>
  const roster = rooms.filter((r) => inRoster(r))
  const counts = await roomEventCounts()

  const area = (AREAS as readonly string[]).includes(q.area ?? '') ? q.area! : 'all'
  const sort: Sort = (SORTS as readonly string[]).includes(q.sort ?? '')
    ? (q.sort as Sort) : 'sessions'
  /* Descending by default on every numeric column, ascending on the name —
     the same defaults the prototype carries (`dir: -1`, `name` ascending). */
  const dir = q.dir === 'asc' ? 1 : -1

  const shown = roster
    .filter((r) => area === 'all' || r.area.replace('_', '-') === area)
    .map((r) => {
      const c = counts.get(r.slug) ?? { sessions: 0, outbound: 0 }
      const cov = coverageFor(r)
      const ver = verificationFor(r)
      return { r, cov, ver, sessions: c.sessions, outbound: c.outbound }
    })
  shown.sort((a, b) => {
    if (sort === 'name') return dir * a.r.name.localeCompare(b.r.name)
    if (sort === 'filled') return dir * (a.cov.filled - b.cov.filled)
    if (sort === 'verified') return dir * (a.ver.stamped - b.ver.stamped)
    return dir * (a[sort === 'sessions' ? 'sessions' : 'outbound']
      - b[sort === 'sessions' ? 'sessions' : 'outbound'])
  })

  /* ⚠️ TOTALS OVER WHAT IS SHOWN, NOT OVER THE ROSTER. A totals row that
     ignored the area filter would contradict the rows above it, and the reader
     would have no way to tell which one was answering their question. */
  const totals = shown.reduce((t, x) => ({
    sessions: t.sessions + x.sessions, outbound: t.outbound + x.outbound,
    filled: t.filled + x.cov.filled, stamped: t.stamped + x.ver.stamped,
  }), { sessions: 0, outbound: 0, filled: 0, stamped: 0 })

  const href = (next: Partial<{ area: string; sort: Sort; dir: string }>) => {
    const p = new URLSearchParams({ tab: 'rooms', area, sort, dir: dir === 1 ? 'asc' : 'desc' })
    for (const [k, v] of Object.entries(next)) p.set(k, String(v))
    return `/admin/growth?${p.toString()}`
  }
  /* The arrow marks the ACTIVE column only, and clicking it flips direction. */
  const col = (key: Sort, label: string) => (
    <Link href={href({ sort: key, dir: sort === key && dir === -1 ? 'asc' : 'desc' })}
      className="ge-sort">
      {label}{sort === key ? (dir === -1 ? ' \u2193' : ' \u2191') : ''}
    </Link>
  )

  return (
    <section className="ge-section">
      <div className="ge-section-head">
        <h2 className="ge-h2">Rooms</h2>
        <nav className="ge-seg">
          {AREAS.map((a) => (
            <Link key={a} href={href({ area: a })}
              className={a === area ? 'ge-seg-opt ge-seg-on' : 'ge-seg-opt'}>
              {a.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>
      <p className="ge-copy">
        {shown.length} of {roster.length} rooms. FILLED and VERIFIED are separate columns
        and always will be — holding a figure and having stood in the room are different
        claims. A room reading 0 sessions is a FINDING, not an absence: the producer
        exists and measured nothing.
      </p>
      <table className="ge-table">
        <thead>
          <tr><th>{col('name', 'ROOM')}</th><th>AREA</th>
            <th>{col('filled', 'FILLED')}</th><th>{col('verified', 'VERIFIED')}</th>
            <th className="num">{col('sessions', 'SESSIONS 7d')}</th>
            <th className="num">{col('outbound', 'OUTBOUND 7d')}</th><th>7d Δ</th></tr>
        </thead>
        <tbody>
          {shown.map(({ r, cov, ver, sessions: sc, outbound: oc }) => {
            const c = { sessions: sc, outbound: oc }
            /* ⚠️ 0 IS A MEASUREMENT HERE. The producer exists and has run; a
               room with no clicks measured none. An em-dash would hide it. */
            const sessions = metric(true, 0, c.sessions)
            const outbound = metric(true, 0, c.outbound)
            /* ⚠️ THE DELTA NEEDS A PRIOR WINDOW THAT PREDATES THE DATA. */
            const delta = metric(true, 2, null)
            return (
              <tr key={r.slug}>
                <td><Link href={`/rooms/${r.slug}`}>{r.name}</Link></td>
                <td className="num">{r.area.replace('_', '-')}</td>
                <td>
                  <span className="num">{cov.filled}/{COVERAGE_FIELDS.length}</span>
                  {cov.missing.length > 0 && (
                    <span className="ge-missing"> missing {cov.missing.join(', ')}</span>
                  )}
                </td>
                <td>
                  <span className="num">{ver.stamped} facts</span>
                  <span className="ge-dim"> {ver.newest ? `newest ${ver.newest.slice(0, 10)}` : 'never'}</span>
                  <span className="ge-dim"> room stamp {r.verified_at ? r.verified_at.slice(0, 10) : '—'}</span>
                </td>
                <td className={sessions.kind === 'number' ? 'num' : 'ge-fig-absent'}>{render(sessions)}</td>
                <td className={outbound.kind === 'number' ? 'num' : 'ge-fig-absent'}>{render(outbound)}</td>
                <td className="ge-fig-absent">{render(delta)}</td>
              </tr>
            )
          })}
        </tbody>
        {/* ⚠️ TOTALS ARE SUMS OF MEASURED COUNTS, and the 7d Δ has no total
            because there is no prior window to difference against — an empty
            cell rather than a zero, which would be a claim. */}
        <tfoot>
          <tr className="ge-total">
            <td>{shown.length} rooms</td>
            <td className="ge-dim">{area === 'all' ? 'all areas' : area}</td>
            <td className="num">{totals.filled}/{shown.length * COVERAGE_FIELDS.length}</td>
            <td className="num">{totals.stamped} facts</td>
            <td className="num">{totals.sessions}</td>
            <td className="num">{totals.outbound}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="ge-copy ge-dim">
        FILLED counts {COVERAGE_FIELDS.length} tracked fields: {COVERAGE_FIELDS.map((f) => f.label).join(', ')}.
        Dress code, drinks, house rules and descriptions are outside the denominator — they
        are 0/17 across the board, so counting them would move every room down for a reason
        about our checking rather than the room.
      </p>
    </section>
  )
}

function Tests() {
  /* ⚠️ SHIPS EMPTY, ON PURPOSE. The design's nine tests are the designer's
     invention. Filing them would fabricate a test history — a record of
     decisions nobody made. */
  return (
    <section className="ge-section">
      <h2 className="ge-h2">Tests</h2>
      <table className="ge-table">
        <thead><tr><th>ID</th><th>HYPOTHESIS</th><th>SURFACE</th><th>STATUS</th><th>READ</th></tr></thead>
        <tbody><tr><td colSpan={5} className="ge-empty">
          No tests filed. This table is empty because no experiment has been run — not
          because none has been recorded.
        </td></tr></tbody>
      </table>
    </section>
  )
}

function Spec() {
  /* ⚠️ GENERATED FROM THE SAME CONSTANTS THE QUERIES USE, so it cannot drift
     from what is measured. A hand-maintained spec describes last month. */
  return (
    <section className="ge-section">
      <h2 className="ge-h2">Instrumentation</h2>
      <p className="ge-copy">
        {SPEC.eventNames.length} events. Every number on the other four tabs resolves to
        one of them. If a figure cannot be traced to a row here, it does not go on the
        page — it reads as an absence instead.
      </p>

      {/* ⚠️ COUNTED SITS BESIDE NOT COUNTED, and the pair is the definition.
          Only half of it shipped: the page said what it throws away and never
          said what it keeps, which leaves the reader to infer the denominator
          of every figure above. Two columns split by a 2px rule, per
          readme.md:182. */}
      <div className="ge-split">
        <div className="ge-split-cell">
          <span className="ge-kicker">Counted</span>
          <p className="ge-copy">
            A device that reaches a decision surface — a room&rsquo;s own document, a
            tournament row, a source link — inside a Monday–Sunday week. Anonymous and
            device-scoped: `device_id` is a random token in localStorage, not a
            fingerprint, and `analytics.devices` keeps one row per device so
            &ldquo;new&rdquo; means ever rather than this week.
          </p>
        </div>
        <div className="ge-split-cell">
          <span className="ge-kicker">Not counted</span>
          <table className="ge-table">
            <tbody>{SPEC.notCounted.map(([w, why]) => (
              <tr key={w}><td>{w}</td><td className="ge-dim">{why}</td></tr>))}</tbody>
          </table>
        </div>
      </div>

      <h2 className="ge-h2">What the three absences mean</h2>
      <table className="ge-table">
        <thead><tr><th>SHOWS</th><th>MEANS</th></tr></thead>
        <tbody>
          <tr><td className="ge-fig-absent">—</td>
            <td>No producer exists. Nothing feeds this and nothing has.</td></tr>
          <tr><td className="num">0</td>
            <td>A producer exists and measured zero. That is a finding.</td></tr>
          <tr><td className="ge-fig-absent">first reading &lt;date&gt;</td>
            <td>A producer exists; no complete week has elapsed. The date is derived from
              the first event, never typed — and once it passes without a number, the cell
              becomes an error rather than a state.</td></tr>
        </tbody>
      </table>

      <h2 className="ge-h2">Events counted</h2>
      <table className="ge-table">
        <thead><tr><th>EVENT</th><th>FIRES WHEN</th><th>PROPERTIES</th>
          <th>FEEDS</th><th>DECISION?</th></tr></thead>
        <tbody>
          {SPEC.eventNames.map((e) => {
            const f = SPEC.eventFacts[e]
            return (
              <tr key={e}>
                <td className="num">{e}</td>
                <td>{f.when}</td>
                <td className="ge-dim">{f.props}</td>
                <td className="ge-dim">{f.feeds}</td>
                <td>{(SPEC.decisionEvents as readonly string[]).includes(e) ? 'yes' : 'no'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2 className="ge-h2">Sources</h2>
      <table className="ge-table">
        <tbody>{SPEC.sources.map(([w, why]) => (
          <tr key={w}><td className="num">{w}</td><td className="ge-dim">{why}</td></tr>))}</tbody>
      </table>

      <h2 className="ge-h2">Guardrails</h2>
      <table className="ge-table">
        <tbody>{SPEC.guardrails.map(([w, why]) => (
          <tr key={w}><td>{w}</td><td className="ge-dim">{why}</td></tr>))}</tbody>
      </table>

      <p className="ge-copy ge-dim">
        Bot classifier {SPEC.botRulesVersion}. Rate limit {SPEC.rateLimit.events} events per{' '}
        {SPEC.rateLimit.windowMs / 1000}s per session. Every figure on this page is read
        from the constants the queries use.
      </p>
    </section>
  )
}
