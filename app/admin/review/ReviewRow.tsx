'use client'

import { useState, useTransition } from 'react'

import { approve, reject } from './actions'

export type Row = {
  id: string
  room_slug: string | null
  room_name: string | null
  target_table: string
  operation: string
  source_id: string | null
  field: string | null
  old_value: unknown
  new_value: unknown
  confidence: number | null
  agent: string | null
  note: string | null
  source_url: string | null
  fetched_at: string
  created_at: string
  fact_verified_at: string | null
}

const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null)
const show = (v: unknown) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v))

export function ReviewRow({ row, stale }: { row: Row; stale: boolean }) {
  const [pending, start] = useTransition()
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const verified = row.fact_verified_at != null

  function act(fn: () => Promise<{ ok: boolean; error?: string; overrode?: boolean }>) {
    setError(null)
    start(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? 'failed'); return }
      setDone(r.overrode ? 'Applied — and the in-person stamp was cleared.' : 'Applied.')
    })
  }

  return (
    <article style={{
      background: 'var(--cid-ink-700)',
      border: `1px solid ${stale ? 'var(--cid-gold-line)' : 'var(--cid-line-2)'}`,
      borderRadius: 'var(--cid-r-md)',
      padding: 'var(--cid-space-5)',
      display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)',
      opacity: done ? 0.55 : 1,
    }}>
      <div style={{ display: 'flex', gap: 'var(--cid-space-4)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ font: 'var(--cid-room-name)' }}>{row.room_name ?? 'Unknown room'}</span>
        <span className="cid-label">{row.target_table}.{row.field}</span>
        {row.confidence != null && (
          <span className="num" style={{ font: 'var(--cid-tag)', color: 'var(--cid-text-3)' }}>
            CONFIDENCE {Number(row.confidence).toFixed(2)}
          </span>
        )}
      </div>

      {/* OLD vs NEW, side by side. A proposal read as prose is a proposal
          nobody checks. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 'var(--cid-space-5)' }}>
        <div>
          <span className="cid-label">WE HOLD</span>
          <p className="num" style={{ font: 'var(--cid-body)', margin: 'var(--cid-space-2) 0 0' }}>{show(row.old_value)}</p>
        </div>
        <div>
          <span className="cid-label">PROPOSED</span>
          <p className="num" style={{ font: 'var(--cid-body)', margin: 'var(--cid-space-2) 0 0', color: 'var(--cid-gold-300)' }}>{show(row.new_value)}</p>
        </div>
      </div>

      {/* THE COLUMN THAT DECIDES THE VERDICT. Without it every row looks the
          same and the partner's floor data is just another opinion. */}
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0 }}>
        {verified
          ? stale
            ? `PERSON-VERIFIED ${day(row.fact_verified_at)} — and this scrape is dated ${day(row.fetched_at)}, AFTER that visit. Worth re-checking on the floor: the room may have changed.`
            : `PERSON-VERIFIED ${day(row.fact_verified_at)}, which is later than this scrape (${day(row.fetched_at)}). The floor data stands unless you know otherwise.`
          : `Not verified in person. Scraped ${day(row.fetched_at)}.`}
        {row.agent ? ` · ${row.agent}` : ''}
        {row.source_url ? ` · ${row.source_url}` : ''}
      </p>
      {row.note && <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-text-3)', margin: 0 }}>{row.note}</p>}

      {done ? (
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-value)', margin: 0 }}>{done}</p>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--cid-space-4)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => approve(row.id, verified))}
            style={{
              font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-action)',
              color: 'var(--cid-paper)', background: 'var(--cid-accent-700)',
              border: 'none', borderTop: '1px solid var(--cid-gold-300)',
              borderRadius: 'var(--cid-r-sm)', minHeight: 'var(--cid-target)',
              padding: '0 var(--cid-space-5)', cursor: 'pointer',
            }}
          >
            {/* The label states the consequence. Approving over a floor visit is
                a different act from approving an unverified figure, and a button
                that says the same thing for both invites the wrong click. */}
            {verified ? 'OVERRIDE THE FLOOR VISIT' : 'APPROVE'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => reject(row.id))}
            style={{
              font: 'var(--cid-tag)', letterSpacing: 'var(--cid-track-action)',
              color: 'var(--cid-text-3)', background: 'transparent',
              border: '1px solid var(--cid-line-2)', borderRadius: 'var(--cid-r-sm)',
              minHeight: 'var(--cid-target)', padding: '0 var(--cid-space-5)', cursor: 'pointer',
            }}
          >
            REJECT
          </button>
          {verified && (
            <span style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
              Approving clears the in-person stamp — nobody has seen the new value.
            </span>
          )}
        </div>
      )}
      {error && <p className="cid-unverified" style={{ font: 'var(--cid-caption)', margin: 0 }}>{error}</p>}
    </article>
  )
}
