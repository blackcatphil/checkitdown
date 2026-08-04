import Link from 'next/link'

import { supabase } from '@/lib/supabase'

export const metadata = { title: 'Tournaments — Check It Down' }
export const revalidate = 300

/**
 * Zero state is the PRIMARY state here — no tournament has been seeded yet, so
 * this is what a first visitor sees. It says what will be tracked, why it is
 * empty, and what unblocks it. Never "coming soon".
 */
export default async function Tournaments() {
  const { data, count } = await supabase
    .from('tournament_templates')
    .select('slug,name,start_time,total_buy_in,fee_percent,reliability,verified_at,rooms(name,slug)', {
      count: 'exact',
    })
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

  return (
    <main className="cid-page" style={{ padding: 'var(--cid-space-8) 0 var(--cid-space-9)' }}>
      <h1 style={{ font: 'var(--cid-statement)', margin: '0 0 var(--cid-space-6)' }}>Tournaments</h1>
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>{count} events</p>
    </main>
  )
}
