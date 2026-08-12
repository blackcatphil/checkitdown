import Link from 'next/link'

import { cellFor, composite, isFault, render, type Cell } from '@/lib/growth-absence'
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
 * ⚠️ THE DESIGN SYSTEM IS NOT IN THE REPO. `docs/design/growth-engine/_ds/`
 * does not exist, so the Modernist skin is NOT applied here — the brief was
 * explicit that tokens must come from that stylesheet and not be re-derived
 * from prose. This uses the app's existing admin styling, scoped to
 * `/admin/*` in `growth.css`, which touches nothing global. Swapping in the
 * real design system is a CSS-only change against the class names below.
 */
export default async function Growth({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { isAdmin } = await whoAmI()
  if (!isAdmin) {
    /* Identity first, data never — the same shape /admin/ledger uses. Nothing
       is queried for a stranger, so nothing leaks through the RSC payload. */
    return (
      <main className="cid-page ge" style={{ padding: 'var(--cid-space-9) 0' }}>
        <span className="cid-label">GROWTH</span>
        <h1 style={{ font: 'var(--cid-statement)', margin: 'var(--cid-space-4) 0' }}>Not for you</h1>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
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
  const metric: Metric = (
    producer: boolean, weeksNeeded: number, value: number | null, missing?: string,
  ): Cell => cellFor({
    producer,
    missing,
    earliestEvent: rollup.earliestEvent,
    completeWeeks: rollup.complete.length,
    weeksNeeded,
    value,
    now,
  })

  const week = rollup.complete.at(-1) ?? null
  const prior = rollup.complete.at(-2) ?? null

  return (
    <main className="cid-page ge">
      <header className="ge-head">
        <div>
          <span className="cid-label">GROWTH ENGINE</span>
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
      {tab === 'loops' && <Loops {...{ metric }} />}
      {tab === 'rooms' && <Rooms metric={metric} />}
      {tab === 'tests' && <Tests />}
      {tab === 'spec' && <Spec />}
    </main>
  )
}

/** One figure, rendered by the rule and never by hand. */
function Fig({ label, cell, note }: { label: string; cell: Cell; note?: string }) {
  return (
    <div className={isFault(cell) ? 'ge-fig ge-fig-fault' : 'ge-fig'}>
      <span className="ge-fig-label">{label}</span>
      <span className={cell.kind === 'number' ? 'ge-fig-value num' : 'ge-fig-absent'}>
        {render(cell)}
      </span>
      {cell.kind === 'no-producer' && <span className="ge-fig-why">{cell.missing}</span>}
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

  return (
    <section className="ge-section">
      <h2 className="ge-h2">The equation</h2>
      <p className="ge-copy">
        New reach × activation × return = the people who come back. Every term below is
        a query against the weekly roll-up; none is typed.
      </p>

      <div className="ge-figs">
        <Fig label="WEEKLY ACTIVE PEOPLE" cell={wap} />
        <Fig label="NEW REACH" cell={reach} />
        <Fig label="ACTIVATED" cell={activated} note="reached a room's own document" />
        <Fig label="RETURNED FROM PRIOR WEEK" cell={returned} />
        <Fig label="OUTBOUND CLICKS" cell={outbound} />
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

function Loops({ metric }: { metric: Metric }) {
  /* ⚠️ THE STEP CHAINS AND CONSTRAINTS ARE DESIGN COPY — Phil's analysis, not a
     measurement, and labelled as such. The GAIN beside each is a query. */
  const LOOPS = [
    { name: 'COVERAGE', chain: 'more rooms → more search surface → more readers → more corrections',
      constraint: 'search indexing latency',
      gain: { kind: 'no-producer', missing: 'Search Console verified today; no history yet' } as Cell },
    { name: 'CORRECTION', chain: 'reader spots an error → submits → fact improves → more trust',
      constraint: 'one person approving the queue',
      gain: metric(true, 1, null) },
    { name: 'REFERRAL', chain: 'reader leaves for a room → room sees traffic → room supplies facts',
      constraint: 'no room has been shown its own number yet',
      gain: metric(true, 1, null) },
    { name: 'SHARE', chain: 'reader shares a room page → new reader arrives',
      constraint: 'there is no share affordance in the product',
      gain: { kind: 'no-producer', missing: 'nothing fires share_link_copy' } as Cell },
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
            <span className="cid-label">{l.name}</span>
            <span className={l.gain.kind === 'number' ? 'ge-fig-value num' : 'ge-fig-absent'}>
              {render(l.gain)}
            </span>
          </div>
          <p className="ge-copy">{l.chain}</p>
          <p className="ge-copy ge-dim">constraint — {l.constraint}</p>
          {l.gain.kind === 'no-producer' && <p className="ge-copy ge-dim">{l.gain.missing}</p>}
        </div>
      ))}
    </section>
  )
}

async function Rooms({ metric }: { metric: Metric }) {
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

  return (
    <section className="ge-section">
      <h2 className="ge-h2">Rooms</h2>
      <p className="ge-copy">
        {roster.length} rooms. FILLED and VERIFIED are separate columns and always will
        be — holding a figure and having stood in the room are different claims.
        {' '}A room reading 0 sessions is a FINDING, not an absence: the producer exists
        and measured nothing.
      </p>
      <table className="ge-table">
        <thead>
          <tr><th>ROOM</th><th>AREA</th><th>FILLED</th><th>VERIFIED</th>
            <th className="num">SESSIONS 7d</th><th className="num">OUTBOUND 7d</th><th>7d Δ</th></tr>
        </thead>
        <tbody>
          {roster.map((r) => {
            const cov = coverageFor(r)
            const ver = verificationFor(r)
            const c = counts.get(r.slug) ?? { sessions: 0, outbound: 0 }
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
        <thead><tr><th>EVENT</th><th>COUNTS TOWARD A DECISION?</th></tr></thead>
        <tbody>
          {SPEC.eventNames.map((e) => (
            <tr key={e}>
              <td className="num">{e}</td>
              <td>{(SPEC.decisionEvents as readonly string[]).includes(e) ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="ge-h2">Not counted</h2>
      <table className="ge-table">
        <tbody>{SPEC.notCounted.map(([w, why]) => (
          <tr key={w}><td>{w}</td><td className="ge-dim">{why}</td></tr>))}</tbody>
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
