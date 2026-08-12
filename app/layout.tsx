import type { Metadata, Viewport } from 'next'
import Link from 'next/link'

import { BottomNav } from './BottomNav'
import { InstallPromptCapture } from './InstallPromptCapture'
import { ServiceWorker } from './ServiceWorker'
import { SiteFooter } from './SiteFooter'

import { SITE_URL } from '@/lib/site'
import { readServerToken } from '@/lib/tokens-server'

import './globals.css'

export const metadata: Metadata = {
  /* The real domain, set the day it landed (2026-08-07). Every relative
     canonical and OG URL resolves against this; without it they resolve
     against whatever host served the page — which was the .vercel.app
     deployment URL, a spelling of the site we never want indexed. */
  /* Shared with the sitemap and robots.txt so the three cannot drift into
     advertising two spellings of the same site. */
  metadataBase: new URL(SITE_URL),
  title: 'Check It Down — every poker room in the Las Vegas valley',
  description:
    'Independent map and rankings of every poker room in the Las Vegas valley. '
    + 'Every fact carries a source and a verified date.',
  /* iOS IGNORES THE MANIFEST FOR MOST OF THIS. Android reads `name`, `icons`
     and `display` from the web manifest; iOS reads its own meta tags and its
     own `apple-touch-icon` link, and silently falls back to a screenshot of the
     page as the icon when they are missing. Both have to be stated. */
  appleWebApp: {
    capable: true,
    title: 'Check It Down',
    /* The status bar sits ON the page in standalone mode. `black-translucent`
       plus `viewportFit: 'cover'` below means the app owns the full screen and
       the safe-area insets keep content out from under the notch. */
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

/**
 * There was NO viewport meta tag at all before 2026-08-07, which is why the
 * desktop layout was being rendered at desktop width and scaled down on a
 * phone rather than reflowing. Every media query in `globals.css` depends on
 * this line existing.
 *
 * `maximumScale` and `userScalable` are deliberately NOT set: capping zoom is
 * an accessibility failure, and the 44px targets mean nobody should need it
 * anyway.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /* Draws under the notch and the home indicator; `env(safe-area-inset-*)` in
     globals.css keeps content clear of both. */
  viewportFit: 'cover',
  /* Same token the manifest uses, so the browser chrome and the installed app
     cannot disagree about what colour this product is. */
  themeColor: readServerToken('--cid-ink-800'),
}

/* VERIFIED DAILY is the trust signal and never drops out of the header. */
/* THE HEADER'S NAV IS DESKTOP-ONLY as of 2026-08-09 — `.cid-nav` is display:
   none below the phone breakpoint and <BottomNav> carries these same four
   destinations there. The list stays here rather than being lifted into a
   shared constant: they are two different navs with two different label sets
   ("JUST THE FACTS" has room here, "FACTS" is what fits a quarter of 390px),
   and pretending otherwise would mean one of them wearing the wrong label. */
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
          {/* THE LOCKUP — mark then wordmark, one link.
              ⚠️ THE SAME ARTWORK AS THE ICONS, not a redrawn SVG. A hand-drawn
              copy would be a second mark the moment the tokens move, and this
              project has already watched an icon set stay aubergine for five
              days after the palette was retired. `public/mark-64.png` comes out
              of `scripts/make-icons.py` beside the home-screen icons, from the
              same tokens, so the header cannot drift from the tab.
              64px source in a 32px slot: crisp on a 2x display, cleanly
              downsampled on a 1x one. The full CID mark rather than the
              small-size variant, because the wordmark is right beside it — the
              mark is carrying identity here, not text. */}
          <Link
            href="/"
            className="cid-brand"
            style={{
              font: 'var(--cid-room-name)',
              color: 'var(--cid-text)',
              borderBottom: 'none',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--cid-space-3)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a 64px
                generated PNG at a fixed size; the image pipeline has nothing to
                optimise and would add a proxy hop to every page in the app. */}
            <img
              src="/mark-64.png"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="cid-mark"
            />
            Check It Down
          </Link>
          {/* NO INLINE LAYOUT HERE. `display: flex` inline beat
              `.cid-nav { display: none }` in the phone media query, so this nav
              shipped on every phone alongside the bottom bar — two navs, which
              the bottom-bar ruling exists to prevent. The layout is in
              globals.css now; see the note above `.cid-nav`. */}
          <nav className="cid-nav">
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
          className="cid-label cid-header-tag"
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
        <ServiceWorker />
        {/* ABOVE THE ROUTER ON PURPOSE. `beforeinstallprompt` fires once, on
            whichever page the reader landed on, and /install is only ever
            reached by a link from somewhere else — so a listener mounted on
            that page would be mounted after the event it exists to catch. */}
        <InstallPromptCapture />
        <SiteHeader />
        {children}
        <SiteFooter />
        {/* Rendered on every route and hidden above the phone breakpoint by
            CSS, not by JS. A JS-gated nav would flash on first paint and would
            be absent from the server HTML that the contrast and overflow gates
            read — the bar has to exist in the markup to be measurable. */}
        <BottomNav />
      </body>
    </html>
  )
}
