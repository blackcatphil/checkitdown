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
