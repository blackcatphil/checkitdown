'use client'

import { useState, useSyncExternalStore } from 'react'

import { INSTALL_URL, type Platform } from '@/lib/install'
import {
  installPromptSnapshot, isDesktopClassTouchDevice, isStandalone, notStandalone,
  serverInstallPromptSnapshot, showInstallPrompt, subscribeNever,
  subscribeToDisplayMode, subscribeToInstallPrompt,
} from '@/lib/install-prompt'

/**
 * ONE SET OF INSTRUCTIONS, FOR THE DEVICE IN THE READER'S HAND.
 *
 * The server picks the branch from the user agent and this component renders
 * the same branch on its first pass, so there is no hydration mismatch and no
 * flash of the wrong platform. Two things only the browser knows are applied
 * afterwards:
 *
 *   STANDALONE. If this document is already the installed app, every set of
 *   instructions on this page is wrong — including Android's, because
 *   `beforeinstallprompt` never fires for an app that is already installed and
 *   the button would simply never appear with no explanation.
 *
 *   THE IPAD. It sends a Macintosh user agent by default, so the server calls
 *   it desktop. `maxTouchPoints` gives it away, and only in the browser. An
 *   explicit `?platform=` in the URL always wins over this correction: a reader
 *   who has said which device they mean is not to be argued with.
 */

type Outcome = 'idle' | 'prompting' | 'accepted' | 'dismissed' | 'installed'

const heading: React.CSSProperties = { font: 'var(--cid-h2)', margin: 0 }
const body: React.CSSProperties = {
  font: 'var(--cid-body)', color: 'var(--cid-text-2)', margin: 0, maxWidth: 'var(--cid-measure)',
}
const quiet: React.CSSProperties = {
  font: 'var(--cid-caption)', color: 'var(--cid-text-3)', margin: 0, maxWidth: 'var(--cid-measure)',
}

export function InstallGuide({
  platform: fromServer,
  overridden,
  qrModules,
}: { platform: Platform; overridden: boolean; qrModules: number }) {
  /* Three reads of state React does not own, all through the one hook that
     renders the server's answer during hydration and the browser's answer
     immediately after. Writing any of them from an effect would put a frame of
     something-that-was-never-true on the screen. */
  const standalone = useSyncExternalStore(subscribeToDisplayMode, isStandalone, notStandalone)
  const tablet = useSyncExternalStore(subscribeNever, isDesktopClassTouchDevice, notStandalone)
  const prompt = useSyncExternalStore(
    subscribeToInstallPrompt, installPromptSnapshot, serverInstallPromptSnapshot,
  )

  const [chosen, setOutcome] = useState<Outcome>('idle')
  /* `appinstalled` beats whatever the button last reported: it is the browser
     saying the thing is done, and it can fire without the button at all. */
  const outcome: Outcome = prompt.installed ? 'installed' : chosen

  /* An explicit ?platform= always wins. A reader who has said which device they
     mean is not to be second-guessed by a heuristic. */
  const platform: Platform = !overridden && fromServer === 'desktop' && tablet ? 'ios' : fromServer

  if (standalone) {
    return (
      <section data-install="standalone" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-5)' }}>
        <h2 style={heading}>It&rsquo;s already installed.</h2>
        <p style={body}>
          You are reading this inside the installed app — no browser bar, no
          tabs. There is nothing left to add. Check It Down is on your home
          screen; this page is only useful from a browser.
        </p>
      </section>
    )
  }

  if (platform === 'ios') return <IosSteps />
  if (platform === 'android') {
    return <AndroidSteps offered={prompt.deferred != null} outcome={outcome} setOutcome={setOutcome} />
  }
  return <DesktopQr modules={qrModules} />
}

/* ── iOS ──────────────────────────────────────────────────────────────────── */

/**
 * NO SCREENSHOT OF THE iOS SHARE SHEET, and that is a ruling rather than an
 * omission. A mocked-up menu is dated the day it is drawn: the sheet's layout,
 * its icons and the position of "Add to Home Screen" in it have all moved
 * across iOS versions, so a picture that does not match the reader's own screen
 * teaches them they are in the wrong place. The Share GLYPH is stable — it has
 * been the same square-with-an-arrow for a decade — so that is drawn, once, and
 * the rest is words.
 */
function IosSteps() {
  return (
    <section data-install="ios" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)' }}>
      <h2 style={heading}>Three taps, in Safari.</h2>
      <ol className="cid-steps">
        <li>
          <span className="cid-step-body">
            Tap the <strong>Share</strong> button in Safari&rsquo;s toolbar. It looks
            like this:
          </span>
          <ShareGlyph />
        </li>
        <li>
          <span className="cid-step-body">
            Scroll the list that opens until you find{' '}
            <strong>Add to Home Screen</strong>. It sits below the row of apps,
            past Copy and Bookmark.
          </span>
        </li>
        <li>
          <span className="cid-step-body">
            Tap <strong>Add</strong>. That is it — the icon is on your home
            screen and it opens full screen, with no browser bar.
          </span>
        </li>
      </ol>
      <p style={quiet}>
        iOS gives a website no way to do this for you: there is no button we can
        put here that would work, so we are not going to draw one. It has to be
        the gesture.
      </p>
      <p style={quiet}>
        Reading this in Chrome, Firefox or an app&rsquo;s built-in browser? They
        all have the same item, in their own menu rather than Safari&rsquo;s. If
        you cannot find it, open{' '}
        <span className="num">checkitdown.com/install</span> in Safari.
      </p>
    </section>
  )
}

/** The iOS Share glyph, drawn from primitives. Not traced from a screenshot,
 *  not an emoji — an emoji renders as whatever the reader's font decides. */
function ShareGlyph() {
  return (
    <span className="cid-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M8.5 10H6.5A2.5 2.5 0 0 0 4 12.5v6A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-6A2.5 2.5 0 0 0 17.5 10h-2" />
        <path d="M12 14.5V3.5" />
        <path d="M8.6 6.9 12 3.5l3.4 3.4" />
      </svg>
    </span>
  )
}

/* ── Android ──────────────────────────────────────────────────────────────── */

/**
 * THE BUTTON IS THE SHORTCUT, NOT THE ROUTE.
 *
 * The menu instructions are rendered ALWAYS and the button appears above them
 * only once the browser has actually handed us a prompt. That ordering is the
 * whole design, and it settles four states at once without a timer:
 *
 *   already installed   the event never fires, so no button — and the menu
 *                       path is still true and still works.
 *   unsupported browser Firefox and Samsung Internet do not fire the event.
 *                       Same outcome: no button, working instructions.
 *   still deciding      Chromium fires the event a moment after load. The
 *                       button appears when it does; nothing was ever dead.
 *   dismissed           the event is consumed, the button goes away, and the
 *                       text says plainly that nothing was installed.
 *
 * The alternative — render the button immediately, wire it to a prompt that may
 * never arrive — is a button that does nothing when tapped, which is worse than
 * no button at all.
 */
function AndroidSteps({
  offered, outcome, setOutcome,
}: { offered: boolean; outcome: Outcome; setOutcome: (o: Outcome) => void }) {
  async function install() {
    setOutcome('prompting')
    const result = await showInstallPrompt()
    if (result === 'accepted') setOutcome('accepted')
    else if (result === 'dismissed') setOutcome('dismissed')
    else setOutcome('idle')
  }

  return (
    <section data-install="android" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)' }}>
      <h2 style={heading}>One tap, if your browser offers it.</h2>

      {outcome === 'installed' || outcome === 'accepted' ? (
        <p style={body} role="status">
          Installed. Check It Down is on your home screen — close this tab and
          open it from there.
        </p>
      ) : (
        <>
          {offered && (
            <button type="button" className="cid-install-btn" onClick={install}
              disabled={outcome === 'prompting'}
            >
              {outcome === 'prompting' ? 'WAITING FOR ANDROID…' : 'ADD TO HOME SCREEN'}
            </button>
          )}
          {outcome === 'dismissed' && (
            <p style={body} role="status">
              You said no, and nothing was installed. That is the end of what the
              button can do — the browser only offers it once. The menu below
              still works.
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-4)' }}>
            <span className="cid-label">BY HAND, IN ANY BROWSER</span>
            <p style={body}>
              Open the browser&rsquo;s menu — the <span className="num">⋮</span>{' '}
              at the top right in Chrome — and choose <strong>Install app</strong>.
              Firefox and Samsung Internet call it <strong>Add to Home
              screen</strong> and put it in the same menu.
            </p>
            <p style={quiet}>
              {offered
                ? 'The same thing the button does, with one more tap.'
                : 'The button is not on this page because your browser has not offered '
                  + 'us one — either it does not do that, or the app is already installed. '
                  + 'The menu works either way.'}
            </p>
          </div>
        </>
      )}
    </section>
  )
}

/* ── Desktop ──────────────────────────────────────────────────────────────── */

/**
 * A LAPTOP IS NOT WHERE THIS APP IS USED, so the desktop branch does not try to
 * install anything. It hands the page to the phone and says why.
 */
function DesktopQr({ modules }: { modules: number }) {
  return (
    <section data-install="desktop" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--cid-space-6)' }}>
      <h2 style={heading}>Point your phone at this.</h2>
      <div
        className="cid-qr"
        /* The grid the rendered image must be an exact multiple of. See the
           note in globals.css: a fractional module width is the difference
           between a symbol that scans at arm's length and one that takes three
           tries. */
        style={{ '--cid-qr-modules': modules } as React.CSSProperties}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a build-time
            SVG of fixed size; the image pipeline has nothing to optimise and
            would only add a proxy hop for 8KB of vector. */}
        <img src="/install/qr.svg" width={modules * 8} height={modules * 8}
          alt={`QR code linking to ${INSTALL_URL}`}
        />
      </div>
      <p style={body}>
        Open the camera, hold it up, tap the link that appears. It brings you
        back to this page on the phone, where the instructions are the ones for
        the phone you are holding — which is where the install actually happens.
      </p>
      <p style={body}>
        Or type it: <span className="num">checkitdown.com/install</span>
      </p>
      <p style={quiet}>
        There is no desktop version to install and there is deliberately no
        button here for one. The point of the app is having the map one tap away
        while you are standing in a room deciding whether to sit down, and no
        part of that happens at a desk.
      </p>
    </section>
  )
}
