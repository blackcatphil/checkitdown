'use client'

import { useState } from 'react'

import { supabase } from '@/lib/supabase'

/**
 * Corrections are WRITE-ONLY for the public: anon holds INSERT and no SELECT,
 * enforced by policy and again by withholding the grant. So this never reads
 * back and never claims to — it confirms the submission and stops.
 *
 * This is the other half of the empty state. A gap that can be corrected is an
 * input; a gap that just sits there is an apology.
 */
export function CorrectionForm({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setState('sending')
    const { error: err } = await supabase.from('corrections').insert({
      room_id: roomId,
      message: message.trim(),
      contact: contact.trim() || null,
    })
    if (err) {
      setError(err.message)
      setState('error')
      return
    }
    setState('sent')
    setMessage('')
    setContact('')
  }

  if (state === 'sent') {
    return (
      <p style={{ font: 'var(--cid-body)', color: 'var(--cid-value)', margin: 0 }}>
        Thank you — that is in the review queue. We do not publish it until a human
        confirms it, same as everything else here.
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          font: 'var(--cid-tag)',
          letterSpacing: 'var(--cid-track-action)',
          color: 'var(--cid-accent-300)',
          background: 'transparent',
          border: '1px solid var(--cid-accent-line)',
          borderRadius: 'var(--cid-r-sm)',
          minHeight: 'var(--cid-target)',
          padding: '0 var(--cid-space-5)',
          cursor: 'pointer',
        }}
      >
        REPORT A CORRECTION
      </button>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
      <label style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
        What have we got wrong about {roomName}?
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          required
          style={{
            display: 'block',
            width: '100%',
            marginTop: 'var(--cid-space-2)',
            font: 'var(--cid-body)',
            color: 'var(--cid-text)',
            background: 'var(--cid-ink-800)',
            border: '1px solid var(--cid-line-2)',
            borderRadius: 'var(--cid-r-sm)',
            padding: 'var(--cid-space-4)',
            resize: 'vertical',
          }}
        />
      </label>
      <label style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)' }}>
        Contact — optional, anonymous by default
        <input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 'var(--cid-space-2)',
            font: 'var(--cid-body)',
            color: 'var(--cid-text)',
            background: 'var(--cid-ink-800)',
            border: '1px solid var(--cid-line-2)',
            borderRadius: 'var(--cid-r-sm)',
            minHeight: 'var(--cid-target)',
            padding: '0 var(--cid-space-4)',
          }}
        />
      </label>
      {state === 'error' && (
        <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-text-2)', margin: 0 }}>
          That did not send: {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 'var(--cid-space-4)' }}>
        <button
          type="submit"
          disabled={state === 'sending'}
          style={{
            font: 'var(--cid-tag)',
            letterSpacing: 'var(--cid-track-action)',
            color: 'var(--cid-paper)',
            background: 'var(--cid-accent-700)',
            borderTop: '1px solid var(--cid-accent-300)',
            border: 'none',
            borderRadius: 'var(--cid-r-sm)',
            minHeight: 'var(--cid-target)',
            padding: '0 var(--cid-space-6)',
            cursor: 'pointer',
          }}
        >
          {state === 'sending' ? 'SENDING' : 'SEND'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            font: 'var(--cid-tag)',
            letterSpacing: 'var(--cid-track-action)',
            color: 'var(--cid-dim)',
            background: 'transparent',
            border: '1px solid var(--cid-line-2)',
            borderRadius: 'var(--cid-r-sm)',
            minHeight: 'var(--cid-target)',
            padding: '0 var(--cid-space-5)',
            cursor: 'pointer',
          }}
        >
          CANCEL
        </button>
      </div>
    </form>
  )
}
