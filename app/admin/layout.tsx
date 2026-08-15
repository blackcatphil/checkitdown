import Link from 'next/link'

import { cellFor, render, type Cell } from '@/lib/growth-absence'
import { COVERAGE_FIELDS, verificationFor } from '@/lib/ledger'
import { readRollup } from '@/lib/growth'
import { inRoster, type RosterRoom } from '@/lib/roster'
import { supabase } from '@/lib/supabase'
import { whoAmI } from '@/lib/supabase-admin'

import './admin.css'

/* The frame reads who is asking and how fresh the roster is; neither is
   cacheable and both change per request. */
export const dynamic = 'force-dynamic'

/**
 * THE ADMIN FRAME.
 *
 * ⚠️ IT WRAPS ALL OF /admin/*, THE REVIEW QUEUE INCLUDED. A Modernist console
 * sitting beside a site-styled queue is the same inconsistency the `.cid-label`
 * leak was, one level up: two design systems meeting inside one screen, with
 * nothing structural stopping either from spreading. `/admin/review` is still
 * site-styled and is the last screen inside this frame that is — see the note
 * on it in docs/design/growth-engine/CONSUMING.md.
 *
 * ⚠️ THE PUBLIC CHROME IS HIDDEN FROM HERE, AND THIS IS INTERIM. `app/layout.tsx`
 * renders the site header, footer and bottom nav as siblings of `{children}`,
 * so an admin page cannot escape them without a `(site)` route group — which
 * means moving six public directories and rewriting every relative import
 * inside them. That is a structural change worth its own pass, not a side
 * effect of this one. Until then `admin.css` hides them with `:has()`, which is
 * declarative, server-rendered and cannot flash. The cost is honest and worth
 * stating: the chrome is still in the DOM, so it is still in the payload.
 *
 * ⚠️ THE NAV IS THE ADMIN SECTIONS, NOT THE CONSOLE'S FIVE TABS. The prototype's
 * header carries Engine/Loops/Rooms/Tests/Spec because its header belongs to
 * the console and nothing else exists. Ours wraps three different screens, so
 * the frame navigates BETWEEN them and the console keeps its own five tabs
 * inside its own page. Putting the console's tabs up here would leave the
 * review queue showing five tabs that all leave it.
 */

/* ⚠️ TWO, NOT THREE. `/admin/ledger` was retired on 2026-08-15 — the Rooms tab
   is a strict superset of it — and the route now only redirects. A nav entry
   pointing at a redirect is a link that flickers through one URL to reach
   another, and it would keep the retired name alive in the one place everyone
   reads. */
const SECTIONS = [
  ['REVIEW', '/admin/review'],
  ['GROWTH', '/admin/growth'],
] as const

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await whoAmI()

  return (
    <div className="ge ge-frame">
      <header className="ge-frame-head">
        {/* ⚠️ THE MARK LINKS TO /admin, NOT `/`. An internal console should not
            hand an admin back to the public homepage — the one place they were
            not trying to go. */}
        <Link href="/admin" className="ge-brand">
          <span className="ge-brand-name">CHECK IT DOWN</span>
          <span className="ge-brand-kicker">Growth engine</span>
        </Link>

        {/* Nothing is offered to somebody who cannot use it: a stranger on
            /admin gets the mark and the sign-in form beneath, not a menu of
            screens that will refuse them. */}
        {isAdmin && (
          <nav className="ge-frame-nav">
            {SECTIONS.map(([label, href]) => (
              <Link key={href} href={href} className="btn btn-secondary">{label}</Link>
            ))}
          </nav>
        )}

        {isAdmin && <WeekSelector />}
      </header>

      {isAdmin && <Ribbon />}

      {children}
    </div>
  )
}

/**
 * ⚠️ NOTHING UNTIL THERE IS SOMETHING TO SELECT.
 *
 * The prototype offers W30/W31/W32. We have one week and it is still running.
 * A segmented control with a single disabled option is furniture pretending to
 * be a choice, so this renders NOTHING until two complete weeks exist and then
 * as many as there are. Its absence today is itself accurate, and it will
 * appear on its own the week the data does.
 */
async function WeekSelector() {
  const rollup = await readRollup()
  if (rollup.complete.length < 2) return null
  return (
    <nav className="ge-seg ge-frame-weeks">
      {rollup.complete.slice(-3).map((w, i, all) => (
        <Link key={w.iso_week} href={`/admin/growth?week=${w.iso_week}`}
          className={i === all.length - 1 ? 'ge-seg-opt ge-seg-on' : 'ge-seg-opt'}>
          {w.iso_week}
        </Link>
      ))}
    </nav>
  )
}

/**
 * THE RIBBON.
 *
 * ⚠️ EVERY FIELD GOES THROUGH THE ABSENCE RULE, including the ones that look
 * too simple to need it. "17 rooms" is a count of a query that can fail, and a
 * ribbon that prints 0 rooms when the roster could not be read is a worse lie
 * than one that prints an em-dash.
 *
 * ⚠️ AND NO `MODELLED DATA` TAG. The prototype carries one because every number
 * in it is invented (readme.md:35). Ours are not, so the tag would be the only
 * false thing on the page.
 */
async function Ribbon() {
  const { data } = await supabase
    .from('rooms')
    .select('slug,area,status,is_seasonal,closed_on,verified_at,'
      + 'cash_games(id,rake_verified_at),room_amenities(amenity_id,verified_at)')
  const reachable = data != null
  const roster = ((data ?? []) as unknown as Array<RosterRoom
    & Parameters<typeof verificationFor>[0]>).filter((r) => inRoster(r))

  /* A producer that could not be read is NOT a producer that measured nothing —
     the distinction the whole console exists to hold. */
  const cell = (value: number | null): Cell => cellFor({
    producer: reachable,
    missing: 'the roster could not be read',
    earliestEvent: new Date(0),
    completeWeeks: 1,
    weeksNeeded: 1,
    value,
    now: new Date(),
  })

  /* ⚠️ ONE CLOCK READING, TAKEN ONCE. `Date.now()` inside the map is an impure
     call per row during render — Next's lint refuses it, and it is right to:
     two rows could straddle a tick and the median would be computed against
     two different "now"s. */
  const now = new Date()
  const ages = roster
    .map((r) => verificationFor(r).newest)
    .filter((d): d is string => d != null)
    .map((d) => (now.getTime() - new Date(d).getTime()) / 3_600_000)
    .sort((a, b) => a - b)
  const median = ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : null
  const stale = ages.filter((h) => h > 48).length

  const rooms = cell(reachable ? roster.length : null)
  const verify = cell(reachable && median != null ? median : null)
  const staleCell = cell(reachable ? stale : null)

  const week = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7))

  return (
    <div className="ge-ribbon">
      <span>{render(rooms)} rooms</span>
      <span aria-hidden="true">·</span>
      <span>median verify {render(verify)}{verify.kind === 'number' ? 'h' : ''}</span>
      <span aria-hidden="true">·</span>
      <span>{render(staleCell)} stale</span>
      <span aria-hidden="true">·</span>
      <span>week of {week.toISOString().slice(0, 10)}</span>
      <span className="ge-ribbon-fields">
        {COVERAGE_FIELDS.length} tracked fields
      </span>
    </div>
  )
}
