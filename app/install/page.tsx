import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'

import { INSTALL_PATH, isPlatform, platformFromUserAgent, type Platform } from '@/lib/install'
import { QR_MODULES } from '@/lib/install-qr'

import { InstallGuide } from './InstallGuide'

/**
 * /install — A PAGE, NOT A MODAL.
 *
 * The site has been installable since 2026-08-07 and nothing here adds a single
 * capability: the manifest, the icons, the iOS meta tags and the service worker
 * were all already there and all already gated. What was missing was that
 * nobody knew. A modal could not have fixed that — a modal is something you
 * dismiss, it cannot be linked to, it cannot be scanned into, and it arrives
 * uninvited on a page somebody opened to look at a map.
 *
 * A page can be linked from the footer, printed, scanned into from a QR code
 * and read at whatever length it needs. It also has to EARN the visit, which is
 * the right pressure: if this page cannot explain why installing is worth
 * doing, the honest conclusion is that it is not.
 *
 * DYNAMIC BECAUSE IT READS THE USER AGENT. The response genuinely differs per
 * reader, so it cannot be prerendered. The QR code — the one expensive thing on
 * the page — is a separate route that IS prerendered, so the cost of being
 * dynamic here is one header read.
 */

export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ platform?: string }> },
): Promise<Metadata> {
  const { platform } = await searchParams
  const overridden = isPlatform(platform)
  return {
    title: 'Install — Check It Down',
    description:
      'Put Check It Down on your phone’s home screen. It opens full screen, '
      + 'one tap from the map, and it still fetches every figure fresh.',
    alternates: { canonical: INSTALL_PATH },
    /* THE SAME RULING AS `/facts?compare=`: an overridden view is a personalised
       spelling of a public page, so it is `noindex, follow`. Without this the
       crawler would find three near-identical pages and pick one at random to
       rank for "install check it down". */
    ...(overridden ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function InstallPage(
  { searchParams }: { searchParams: Promise<{ platform?: string }> },
) {
  const { platform: requested } = await searchParams
  const overridden = isPlatform(requested)
  const ua = (await headers()).get('user-agent')
  const platform: Platform = overridden ? requested : platformFromUserAgent(ua)

  return (
    <main
      className="cid-page"
      style={{
        padding: 'var(--cid-space-8) 0 var(--cid-space-9)',
        display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-7)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)' }}>
        <span className="cid-label">INSTALL</span>
        <h1 style={{ font: 'var(--cid-statement)', margin: 0, maxWidth: '14ch' }}>
          Put it on your home screen.
        </h1>
        <p style={{ font: 'var(--cid-lede)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
          Most people open this while they are already out — deciding whether the
          room they are standing in is the right one. An icon on the home screen
          is a tap; a browser, a tab and a typed address is not.
        </p>
      </div>

      {/* WHAT IT DOES NOT DO, SAID BEFORE THE INSTRUCTIONS RATHER THAN AFTER.
          "Install" means offline to most people, and this app deliberately
          stores nothing — so a reader who installs it expecting offline has
          been misled by one word, by us, on the page that asked them to. The
          reason is the same one the service worker argues at length: a rake
          figure read off a phone's disk tomorrow is yesterday's number wearing
          today's date, and that is worse than a blank screen because it looks
          fine. */}
      <div className="cid-install-note">
        <span className="cid-label">WHAT YOU GET, AND WHAT YOU DO NOT</span>
        <p style={{ font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
          You get the map one tap away, full screen, with no browser bar eating
          the top of the phone. You do <strong>not</strong> get offline. Nothing
          is stored on your phone: every figure is fetched when you open it,
          because a rake we saved yesterday would show up wearing today&rsquo;s
          date. With no signal the app says so and shows you nothing.
        </p>
      </div>

      {/* THE MODULE COUNT TRAVELS AS A CUSTOM PROPERTY, not as a number typed
          into the stylesheet. The CSS sizes the QR to a whole number of pixels
          per module, which needs to know how many modules there are — and that
          is derived from the URL's length, so a longer address one day would
          grow the symbol to a grid the CSS was no longer rounding to. Nothing
          would look broken; it would just scan worse. */}
      <InstallGuide platform={platform} overridden={overridden} qrModules={QR_MODULES} />

      {/* THE ESCAPE HATCH. Detection is a guess — an iPad in its default
          configuration is indistinguishable from a laptop to a server — so
          every reader can name their own device, and the page believes them
          over its own guess. Inline links in a sentence, deliberately: they are
          prose, not the page's controls. */}
      <p style={{ font: 'var(--cid-caption)', color: 'var(--cid-dim)', margin: 0, maxWidth: 'var(--cid-measure)' }}>
        Not the device you are holding? Read the steps for{' '}
        <Link href="/install?platform=ios">iPhone or iPad</Link>,{' '}
        <Link href="/install?platform=android">Android</Link>, or{' '}
        <Link href="/install?platform=desktop">a computer</Link>.
      </p>
    </main>
  )
}
