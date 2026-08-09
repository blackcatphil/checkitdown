'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * THE PHONE'S NAV, AND THE ONLY ONE IT GETS.
 *
 * Ruled 2026-08-09. Below the phone breakpoint the header drops its links and
 * this bar carries them instead — NOT both. A page with two navs is a page
 * where the reader has to work out which one is authoritative, and on a 390px
 * screen the header's four labels were already the widest thing in it.
 *
 * ACTIVE IS WEIGHT AND FULL-STRENGTH INK, NEVER A COLOUR. Same law as the true
 * #1 on /facts: no data state — and no navigation state — is carried by hue.
 * `aria-current` carries it for a screen reader, the weight and the ink carry
 * it for everyone else, and gold stays decorative on the top hairline where it
 * claims nothing.
 *
 * NOTHING HERE IS FILLED. The one-filled-action ceiling is per screen, and a
 * nav item is not the screen's action — filling four of them would spend the
 * commitment colour on furniture and break the ceiling four times over.
 *
 * THE SAFE AREA IS NOT OPTIONAL. This ships as an installed PWA with
 * `viewportFit: 'cover'`, so the home-indicator row is real estate the app
 * draws under. Without the inset the last 34pt of this bar sits beneath the
 * indicator and the right-hand item is the one that stops being tappable.
 */

const ITEMS = [
  ['MAP', '/'],
  ['FACTS', '/facts'],
  ['TOURNAMENTS', '/tournaments'],
  ['PROMOS', '/promos'],
] as const

export function BottomNav() {
  const path = usePathname() ?? '/'

  return (
    <nav className="cid-botnav" aria-label="Primary">
      {ITEMS.map(([label, href]) => {
        /* "/" must match exactly or every route lights the map up. */
        const active = href === '/' ? path === '/' : path.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className="cid-botnav-item"
            data-active={active ? '' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
