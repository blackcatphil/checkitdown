'use client'

import type { ReactNode } from 'react'

/**
 * ONE DISCLOSURE, USED BY EVERY GROUP IN THE PANEL.
 *
 * The stakes sub-heads and the amenity groups share this rather than growing
 * two conventions — a panel where GAMES collapses one way and NLH collapses
 * another is a panel a reader has to learn twice.
 *
 * ═══ THE TRAP THIS COMPONENT EXISTS TO CLOSE ═══
 *
 * A collapsed group whose boxes are still checked FILTERS THE MAP INVISIBLY.
 * The reader sees a dimmed city and no reason for it — the same failure class
 * as a bare "1 room skipped", where the number is true and the room it hides is
 * the thing worth knowing.
 *
 * Two rules answer it, and both are asserted by name in the probe:
 *
 *   1. COLLAPSING NEVER CLEARS A SELECTION. Hiding a control is a view
 *      decision; unchecking it is a data decision, and a disclosure widget has
 *      no business making one. The dim state is byte-identical across a
 *      collapse.
 *   2. A COLLAPSED HEAD CARRIES ITS ACTIVE COUNT — "NO-LIMIT HOLD'EM ·
 *      2 selected". The filter is still visible as a FACT even when its
 *      controls are not, which is the whole difference between hidden chrome
 *      and a hidden claim.
 *
 * A REAL BUTTON, because the sheet-is-a-button ruling applies here too: no
 * gesture-only paths, `aria-expanded` for a screen reader, a 44px target on
 * every platform, and keyboard operation for free.
 */
export function FilterGroup({
  id,
  label,
  open,
  activeCount,
  onToggle,
  children,
  head = 'group',
}: {
  id: string
  label: string
  open: boolean
  activeCount: number
  onToggle: (id: string, activeCount: number) => void
  children: ReactNode
  /** `group` takes the gold eyebrow; `sub` is a stakes variant inside one. */
  head?: 'group' | 'sub'
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-3)' }}>
      <button
        type="button"
        className="cid-disclose"
        aria-expanded={open}
        onClick={() => onToggle(id, activeCount)}
      >
        <span className={head === 'group' ? 'cid-label' : 'num cid-subhead'}>{label}</span>
        {/* THE COUNT IS THE POINT. Rendered only when collapsed AND active:
            open, the checkboxes speak for themselves; inactive, there is
            nothing to disclose. It is deliberately NOT a colour — the palette
            law says no state rides a hue, and a reader who cannot see gold
            still has to be able to see that a filter is on. */}
        {!open && activeCount > 0 && (
          <span className="num cid-disclose-count">· {activeCount} selected</span>
        )}
        <span aria-hidden className="cid-disclose-mark">{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </div>
  )
}
