import Link from 'next/link'

import { supabase } from '@/lib/supabase'

export const revalidate = 300

/**
 * Landing map — the 3D module is not wired in yet, so this states what it is
 * and what is behind it rather than pretending. "Unbuilt surfaces admit it and
 * say what they will do" is a content rule, not just a courtesy.
 */
export default async function Home() {
  const [{ count: roomCount }, { count: gameCount }] = await Promise.all([
    /* Roster count, not a raw row count — closed and seasonal rooms are off it. */
    supabase
      .from('rooms')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'closed')
      .neq('status', 'seasonal')
      .eq('is_seasonal', false),
    supabase.from('cash_games').select('*', { count: 'exact', head: true }),
  ])

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-9) 0' }}>
      <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-5)' }}>
        Every poker room in the valley
      </h1>
      <p
        style={{
          font: 'var(--cid-lede)',
          color: 'var(--cid-text-3)',
          maxWidth: 'var(--cid-measure)',
          margin: '0 0 var(--cid-space-7)',
        }}
      >
        {roomCount ?? 0} rooms and {gameCount ?? 0} cash games are in the database, each
        carrying a source and a fetch date. None is confirmed on site yet, so nothing is
        ranked and every figure is shown tilde&rsquo;d.
      </p>

      <div
        style={{
          border: '1px solid var(--cid-line-1)',
          background: 'var(--cid-ink-700)',
          padding: 'var(--cid-space-7)',
          maxWidth: 'var(--cid-measure)',
        }}
      >
        <span className="cid-label">MAP — NOT WIRED IN YET</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 'var(--cid-space-4) 0 0' }}>
          The 3D map module exists as a built surface and the room coordinates are seeded.
          Wiring it to live data is the next step. The filter panel ships with the GAMES
          group only: a dim on the map means a room does not have the feature, and amenity
          coverage is not yet complete enough for that to be a claim we can stand behind.
        </p>
        <p style={{ font: 'var(--cid-body)', margin: 'var(--cid-space-5) 0 0' }}>
          <Link href="/facts">Just the facts</Link> is live against the database.
        </p>
      </div>
    </main>
  )
}
