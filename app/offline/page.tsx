import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Offline — Check It Down',
  /* Never index the offline shell: it is a state, not a page about anything. */
  robots: { index: false, follow: false },
}

/**
 * THE HONEST OFFLINE STATE.
 *
 * The service worker serves this instead of the last copy of whatever page was
 * asked for. That is the whole ruling in one screen: a cached rake figure
 * served tomorrow is a stale fact presented as current, and it is worse than a
 * blank screen because it looks fine.
 *
 * So this page says what is true — we cannot reach the data — and shows no
 * figures at all. It is the same family as "not yet checked on site" and the
 * confirmed-absence blocks: an honest absence beats a confident wrong answer.
 * There is deliberately nothing here to read except that sentence.
 *
 * IT CARRIES THE BOTTOM NAV, and that is deliberate rather than incidental.
 * The bar lives in the root layout, so it is in this page's precached HTML.
 * Tapping any item while offline re-requests a page, the worker fails to reach
 * the network, and this same screen comes back — which is the honest outcome
 * and the one the app should give: the nav still LOOKS like the app, and every
 * destination reports the same true thing rather than a stale cached copy.
 * Hiding the bar here would have been the worse call. It would make the app
 * look broken at exactly the moment it is behaving correctly, and it would
 * strand a reader on a screen with no way back to the map when connectivity
 * returns. No item shows as current, because /offline is not one of them.
 *
 * Clearance comes from `.cid-page`, which reserves --cid-botnav-clear at the
 * phone breakpoint — the last paragraph here is the thing that would otherwise
 * sit under the bar.
 */
export default function Offline() {
  return (
    <main
      className="cid-page"
      style={{
        padding: 'var(--cid-space-9) 0',
        display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)',
        maxWidth: 'var(--cid-measure)',
      }}
    >
      <span className="cid-label">OFFLINE</span>
      <h1 style={{ font: 'var(--cid-h1)', margin: 0 }}>We can&rsquo;t reach the data.</h1>
      <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-3)', margin: 0 }}>
        You&rsquo;re offline, so there is nothing to show. Every figure in this app
        carries a source and a date, and a number saved to your phone yesterday
        would carry <em>yesterday&rsquo;s</em> — shown as though it were current.
        We would rather show you nothing than that.
      </p>
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0 }}>
        Reconnect and reload. Nothing is cached, so what you see next will be
        what the rooms say now.
      </p>
    </main>
  )
}
