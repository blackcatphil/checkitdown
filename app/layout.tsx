import type { Metadata } from 'next'
import Link from 'next/link'

import './globals.css'

export const metadata: Metadata = {
  title: 'Check It Down — every poker room in the Las Vegas valley',
  description:
    'Independent map and rankings of every poker room in the Las Vegas valley. '
    + 'Every fact carries a source and a verified date.',
}

/* VERIFIED DAILY is the trust signal and never drops out of the header. */
function SiteHeader() {
  const nav = [
    ['MAP', '/'],
    ['JUST THE FACTS', '/facts'],
    ['TOURNAMENTS', '/tournaments'],
    ['PROMOS', '/promos'],
  ] as const

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        height: 'var(--cid-header-h)',
        background: 'var(--cid-ink-700)',
        borderBottom: '1px solid var(--cid-line-2)',
      }}
    >
      <div
        className="cid-page"
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--cid-space-7)',
          justifyContent: 'space-between',
        }}
      >
        {/* min-width:0 / flex:0 1 auto on BOTH groups — two nowrap groups that
            could not shrink is what broke this header before, not a pixel value. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--cid-space-7)',
            minWidth: 0,
            flex: '0 1 auto',
          }}
        >
          <Link
            href="/"
            style={{
              font: 'var(--cid-room-name)',
              color: 'var(--cid-text)',
              borderBottom: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Check It Down
          </Link>
          <nav style={{ display: 'flex', gap: 'var(--cid-space-6)', minWidth: 0 }}>
            {nav.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                style={{
                  font: 'var(--cid-tag)',
                  letterSpacing: 'var(--cid-track-nav)',
                  color: 'var(--cid-dim)',
                  borderBottom: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <span
          className="cid-label"
          style={{ whiteSpace: 'nowrap', minWidth: 0, flex: '0 1 auto' }}
        >
          17 ROOMS · VERIFIED DAILY
        </span>
      </div>
    </header>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  )
}
