import Link from 'next/link'

export const metadata = { title: 'Promotions — Check It Down' }

/**
 * When this page starts reading `promotions` it MUST filter with
 * `isLive()` from lib/roster — `is_active` alone is not enough, because a promo
 * whose `ends_on` has passed is over whether or not anyone cleared the flag.
 * Same for `tournament_instances.is_cancelled` when that surface reads.
 *
 * Promos is the one surface that is honestly not built. It differs from
 * Tournaments (which has a schema and no data) and from amenities (which has
 * real facts and a home): there is nothing behind this at all, so the page says
 * exactly that, what it will track, and what unblocks it.
 */
export default function Promos() {
  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)' }}>
      <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-5)' }}>Promotions</h1>
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
        <span className="cid-label">CITY-WIDE PROMOTION TRACKING — NOT BUILT YET</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0 }}>
          High hands, bad beat jackpots, splash pots, freerolls and locals rates, per room,
          with the amount and the schedule. The table exists in the schema; nothing is
          loaded and nothing here is invented.
        </p>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 0 }}>
          What unblocks it: promotion amounts move hourly — a high hand climbs all day and
          resets. A daily fetch would publish a number that is wrong by the time you read
          it, which is worse than publishing nothing. This page waits on a cadence that
          matches how fast the figure actually changes, and on a rule for showing a
          climbing jackpot honestly. An unknown amount stays NULL; it is never a guess.
        </p>
        <p style={{ font: 'var(--cid-body)', margin: 0 }}>
          <Link href="/facts">Just the facts</Link> is live against the database today.
        </p>
      </div>
    </main>
  )
}
