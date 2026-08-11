import Link from 'next/link'

import { costShape } from '@/lib/tournament-terms'
import { timeLabel, vegasParts } from '@/lib/tournaments'

import { supabase } from '@/lib/supabase'

export const metadata = { title: 'Tournaments — Check It Down' }
export const revalidate = 300

/**
 * Zero state is the PRIMARY state here — no tournament has been seeded yet, so
 * this is what a first visitor sees. It says what will be tracked, why it is
 * empty, and what unblocks it. Never "coming soon".
 */
/** `2026-08-17` -> `MON 17 AUG`. A date heading is furniture: it has to be
 *  scannable at a glance, not parsed. */
function dayHeading(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()]
  const mon = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getUTCMonth()]
  return `${day} ${d.getUTCDate()} ${mon}`
}

export default async function Tournaments({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort } = await searchParams
  const { data } = await supabase
    .from('tournament_templates')
    .select('slug,name,start_time,total_buy_in,fee_percent,guarantee_amount,reliability,'
      + 'verified_at,days_of_week,level_minutes,structure_pdf_url,'
      + 'rebuy_amount,rebuy_max,rebuy_unlimited,addon_amount,addon_max,'
      + 'rooms(name,slug),tournament_instances(starts_at,entry_kind,takes_entry)')
    .eq('is_active', true)
    .order('start_time')

  const events = data ?? []


  if (events.length === 0) {
    return (
      <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)' }}>
        <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-5)' }}>Tournaments</h1>
        <div
          style={{
            border: '1px solid var(--cid-line-1)',
            background: 'var(--cid-ink-700)',
            padding: 'var(--cid-space-7)',
            maxWidth: 'var(--cid-measure)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--cid-space-5)',
          }}
        >
          <span className="cid-label">NO EVENTS LOADED YET</span>
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
            The schema holds every daily and series event as a recurring template that
            generates dated instances, with the buy-in split into prize pool, house fee,
            bounty and staff, and the fee shown as a share of the total. None of it is
            loaded, so this page shows nothing rather than showing an example.
          </p>
          <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 0 }}>
            What unblocks it: the daily schedules are published as PDFs that are replaced
            in place at the same URL, so a fetch alone cannot tell you the schedule
            changed. The source registry hashes each file and raises a review item when
            the hash moves — that pipeline runs before this page can be honest.
          </p>
          <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0 }}>
            One thing will stay editorial and labelled as such: whether a daily
            actually fires. Nobody publishes it, so judgement is the only way to have it —
            and it will never be sortable.
          </p>
          <p style={{ font: 'var(--cid-body)', margin: 0 }}>
            <Link href="/facts">Just the facts</Link> is live against the database today.
          </p>
        </div>
      </main>
    )
  }

  /* ═══ GROUPS ARE THE DEFAULT VIEW ═══
     61 series events plus 4 dailies across 22 days is a wall as a flat table —
     the thing a reader wants is "what is on today", and a date axis answers it
     where a sort cannot.

     TWO KINDS OF ROW, and they group differently on purpose. A series event
     runs ONCE on a date, so it belongs to that date. A daily RECURS and has no
     dates at all; repeating it under all 22 headings would claim 88 events that
     do not exist. So the dailies get one standing group of their own.

     A NON-TIME SORT FLATTENS THE GROUPS, because a table sorted by fee that
     still carries date headings is showing two orders at once and neither is
     true. When that happens the page says so in a banner rather than quietly
     dropping the axis. */
  type Row = {
    key: string; name: string; room: string; roomSlug: string
    at: string | null; time: string
    total: number | null; fee: number | null; guarantee: number | null
    minutes: number | null; verifiedAt: string | null
    takesEntry: boolean; entryKind: string | null; pdf: string | null
    /* Migration 014: what the entry does NOT cover. */
    extras: ReturnType<typeof costShape>['extras']; bounded: boolean
  }
  const rows: Row[] = []
  for (const e of events as unknown as Array<Record<string, never>>) {
    const t = e as unknown as {
      slug: string; name: string; start_time: string; total_buy_in: number | null
      fee_percent: number | null; guarantee_amount: number | null; level_minutes: number | null
      verified_at: string | null; days_of_week: number[] | null; structure_pdf_url: string | null
      rebuy_amount: number | null; rebuy_max: number | null; rebuy_unlimited: boolean
      addon_amount: number | null; addon_max: number | null
      rooms: { name: string; slug: string } | null
      tournament_instances: Array<{ starts_at: string; entry_kind: string; takes_entry: boolean }>
    }
    const cost = costShape(t)
    const base = {
      name: t.name, room: t.rooms?.name ?? '—', roomSlug: t.rooms?.slug ?? '',
      total: t.total_buy_in, fee: t.fee_percent, guarantee: t.guarantee_amount,
      minutes: t.level_minutes, verifiedAt: t.verified_at, pdf: t.structure_pdf_url,
      extras: cost.extras, bounded: cost.bounded,
    }
    if (t.tournament_instances?.length) {
      for (const i of t.tournament_instances) {
        /* The room's own zone, not UTC — see vegasParts. */
        const v = vegasParts(i.starts_at)
        rows.push({ ...base, key: `${t.slug}@${i.starts_at}`, at: v.date,
          time: timeLabel(v.time),
          takesEntry: i.takes_entry, entryKind: i.entry_kind })
      }
    } else {
      rows.push({ ...base, key: t.slug, at: null, time: timeLabel(t.start_time),
        takesEntry: true, entryKind: null })
    }
  }

  const SORTS = { time: 'TIME', buyin: 'ENTRY', fee: 'FEE %' } as const
  const active = (sort === 'buyin' || sort === 'fee') ? sort : 'time'
  const grouped = active === 'time'

  if (active === 'buyin') rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
  else if (active === 'fee') rows.sort((a, b) => (a.fee ?? 99) - (b.fee ?? 99))
  else rows.sort((a, b) => (a.at ?? '9').localeCompare(b.at ?? '9') || a.time.localeCompare(b.time))

  const groups: Array<[string, Row[]]> = []
  if (grouped) {
    const dated = rows.filter((r) => r.at != null)
    const daily = rows.filter((r) => r.at == null)
    if (daily.length) groups.push(['EVERY DAY', daily])
    const byDay = new Map<string, Row[]>()
    for (const r of dated) {
      const d = r.at!
      byDay.set(d, [...(byDay.get(d) ?? []), r])
    }
    for (const [d, rs] of [...byDay.entries()].sort()) groups.push([d, rs])
  } else {
    groups.push(['', rows])
  }

  const Head = () => (
    <div className="cid-tt-row cid-tt-head">
      <span className="cid-label">EVENT</span>
      <span className="cid-label">ROOM</span>
      <span className="cid-label">TIME</span>
      {/* ⚠️ "ENTRY", NOT "BUY-IN". `total_buy_in` is what it costs to sit down
          and nothing more; three of the four Wynn dailies carry a $100 add-on
          and one has unlimited $200 rebuys, so a column headed BUY-IN was
          telling a reader a price that is not the price. The head is the
          cheapest place to fix that, and the extras get their own column rather
          than being folded in — see migration 014 for why no total exists. */}
      <span className="cid-label">ENTRY</span>
      <span className="cid-label">PLUS</span>
      <span className="cid-label">FEE OF ENTRY</span>
      <span className="cid-label">GUARANTEE</span>
    </div>
  )
  /* How many events on this page cost more than their entry, and how many of
     those have no published ceiling at all. Counted once, stated once. */
  const withExtras = rows.filter((r) => r.extras.length > 0).length
  const openEnded = rows.filter((r) => !r.bounded).length

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)' }}>
      <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-4)' }}>Tournaments</h1>
      <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: '0 0 var(--cid-space-5)', maxWidth: '60ch' }}>
        {rows.length} events. <strong>Entry</strong> is what it costs to sit down and{' '}
        <strong>fee</strong> is the house&rsquo;s share of it; the rest is prize pool and
        the poker staff&rsquo;s service charge.
      </p>
      {/* ⚠️ WHAT THE ENTRY DOES NOT COVER, SAID BEFORE THE TABLE RATHER THAN
          INFERRED FROM IT. Neither room publishes how a rebuy or an add-on is
          split between prize pool and house, and one event's rebuys have no
          ceiling — so a total cost is not a figure we hold. Showing the
          components and declining the sum is the same ruling Just the Facts
          carries for every modelled number. */}
      {withExtras > 0 && (
        <p className="cid-tt-banner" style={{ margin: '0 0 var(--cid-space-5)' }}>
          {withExtras} of these {rows.length} events cost more than their entry — rebuys and
          add-ons are listed under <span className="num">PLUS</span>.
          {openEnded > 0 && (
            <> {openEnded === 1 ? 'One of them has' : `${openEnded} of them have`} no published
              ceiling, so no total is shown for {openEnded === 1 ? 'it' : 'them'}.</>
          )}{' '}
          We do not add these up: neither room publishes how a rebuy is split between prize
          pool and house, and how many a player takes is not a fact anybody published.
        </p>
      )}

      <div className="cid-tt-sorts">
        {(Object.keys(SORTS) as Array<keyof typeof SORTS>).map((k) => (
          <Link key={k} href={k === 'time' ? '/tournaments' : `/tournaments?sort=${k}`}
            className={k === active ? 'cid-tt-sort cid-tt-sort-on' : 'cid-tt-sort'}>
            {SORTS[k]}
          </Link>
        ))}
      </div>

      {/* THE BANNER THE DESIGN RECORD ASKS FOR. A non-time sort cannot keep a
          date axis — the two orders contradict — so the page states that it has
          dropped the grouping rather than letting a reader assume it is still
          there. */}
      {!grouped && (
        <p className="cid-tt-banner">
          Sorted by {SORTS[active]} — the date grouping is off, so events from
          different days sit next to each other.
          {/* ⚠️ THE SORT RANKS THE ENTRY, WHICH IS NOT THE COST. A $200 event
              with unlimited rebuys sorting above a $240 one without them is
              true about the entry and misleading about the money, and the
              brief's own standard is that a ranking which says otherwise is
              worse than one that declines. So the sort stays — entry is a real,
              published, comparable figure — and it says out loud what it is
              ordering. */}
          {active === 'buyin' && openEnded > 0 && (
            <> This orders the ENTRY only. {openEnded === 1 ? 'One event' : `${openEnded} events`}{' '}
              here can cost more than the position suggests, and{' '}
              {openEnded === 1 ? 'its' : 'their'} rebuys have no published ceiling.</>
          )}{' '}
          <Link href="/tournaments">Back to the date view</Link>.
        </p>
      )}

      {groups.map(([label, rs]) => (
        <section key={label || 'all'} style={{ marginTop: 'var(--cid-space-6)' }}>
          {label && (
            <h2 className="num cid-tt-day">
              {label === 'EVERY DAY' ? 'EVERY DAY' : dayHeading(label)}
              <span className="cid-tt-day-count"> · {rs.length}</span>
            </h2>
          )}
          <div className="cid-tt">
            <Head />
            {rs.map((r) => (
              <div key={r.key} className="cid-tt-row">
                <span>
                  {r.name}
                  {/* ⚠️ A CONTINUATION TAKES NO BUY-IN. Six Day 2s would
                      otherwise read as entry points and a reader would turn up
                      with cash on the wrong day. */}
                  {r.takesEntry === false && <span className="cid-tt-noentry"> — Day 2, no entry</span>}
                </span>
                <span><Link href={`/rooms/${r.roomSlug}`}>{r.room}</Link></span>
                <span className="num">{r.time}</span>
                <span className="num">{r.takesEntry === false ? '—' : r.total != null ? `$${Number(r.total).toFixed(0)}` : '—'}</span>
                {/* THE EXTRAS, LISTED IN THEIR OWN CELL AND NEVER ADDED TO THE
                    ONE BESIDE THEM. "$200 REBUY · UNLIMITED" is what the room
                    published; "$440" would be a number we invented. */}
                <span className="num cid-tt-plus">
                  {r.takesEntry === false || r.extras.length === 0 ? '—' : r.extras.map((x) => (
                    <span key={x.label} className="cid-tt-extra">
                      ${x.amount.toFixed(0)} {x.label}
                      {x.qualifier && <span className="cid-tt-qual"> · {x.qualifier}</span>}
                    </span>
                  ))}
                </span>
                <span className="num">{r.takesEntry === false ? '—' : r.fee != null ? `${Number(r.fee)}%` : '—'}</span>
                <span className="num">{r.guarantee != null ? `$${Number(r.guarantee).toLocaleString('en-US')}` : '—'}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  )
}
