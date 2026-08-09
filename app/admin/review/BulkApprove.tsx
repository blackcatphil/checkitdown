'use client'

import { useState, useTransition } from 'react'

import { approveAllFromSource } from './actions'

export type SourceGroup = {
  source_id: string
  label: string
  count: number
  /** Proposals in this group that would override a floor visit. */
  overrides: number
}

/**
 * ONE DECISION PER DOCUMENT. The morning apply is sixty rows from one
 * spreadsheet, and the reviewer's actual judgement is about the spreadsheet.
 *
 * The count of rows that would OVERRIDE a floor visit is stated on the button
 * rather than discovered when the run stops, because those are the rows this
 * control deliberately will not approve — see `approveAllFromSource`. A button
 * that says "approve 60" and applies 43 has lied, even if the message
 * afterwards is accurate.
 */
export function BulkApprove({ groups }: { groups: SourceGroup[] }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  if (groups.length === 0) return null

  return (
    <section
      style={{
        border: '1px solid var(--cid-line-2)',
        borderRadius: 'var(--cid-r-md)',
        padding: 'var(--cid-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--cid-space-4)',
      }}
    >
      <span className="cid-label">APPROVE BY SOURCE</span>
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-text-3)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
        Each row is still validated, logged and revalidated on its own. A row
        that would override an in-person check stops the run and is left for you
        to approve by hand.
      </p>

      <div style={{ display: 'flex', gap: 'var(--cid-space-4)', flexWrap: 'wrap' }}>
        {groups.map((g) => (
          <button
            key={g.source_id}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMessage(null)
                const r = await approveAllFromSource(g.source_id)
                setFailed(!r.ok)
                setMessage(r.ok ? r.message : r.error)
              })
            }
            style={{
              font: 'var(--cid-tag)',
              letterSpacing: 'var(--cid-track-action)',
              color: 'var(--cid-paper)',
              background: 'var(--cid-accent-700)',
              border: 'none',
              borderTop: '1px solid var(--cid-gold-300)',
              borderRadius: 'var(--cid-r-sm)',
              minHeight: 'var(--cid-target)',
              padding: '0 var(--cid-space-5)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            APPROVE ALL FROM {g.label.toUpperCase()} · {g.count}
            {g.overrides > 0 ? ` (${g.overrides} WILL STOP THE RUN)` : ''}
          </button>
        ))}
      </div>

      {message && (
        <p
          className={failed ? 'cid-unverified' : undefined}
          style={{ font: 'var(--cid-caption)', color: failed ? undefined : 'var(--cid-value)', margin: 0 }}
        >
          {message}
        </p>
      )}
    </section>
  )
}
