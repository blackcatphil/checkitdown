'use client'

/**
 * THE ANDROID INSTALL PROMPT, CAUGHT ONCE AND HELD.
 *
 * Chromium fires `beforeinstallprompt` when a page meets the installability
 * criteria. Two facts about it decide the whole shape of this file:
 *
 *   IT FIRES ONCE, PER PAGE LOAD, EARLY. If the reader lands on the map and
 *   then taps through to /install — which is the only route to that page — the
 *   event fired minutes earlier on a different route and is gone. So the
 *   listener has to live in the root layout, above the router, and stash the
 *   event where a later page can find it. Listening on /install alone gets you
 *   an install page that can never offer the install.
 *
 *   IT IS CONSUMED BY USE. `prompt()` may be called once per event; calling it
 *   again throws. So after a dismissal the deferred event is dropped rather
 *   than kept for a second try — the page then tells the reader where the
 *   browser's own menu item is, which still works. Re-arming a button that
 *   would throw is the exact failure this whole feature is supposed to avoid.
 *
 * `preventDefault()` SUPPRESSES THE BROWSER'S OWN MINI-INFOBAR, which is the
 * point of catching it at all: the ruling is one quiet link in the footer, and
 * a browser-drawn banner on the map is the interstitial that was ruled out,
 * just drawn by somebody else.
 */

type PromptOutcome = 'accepted' | 'dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: PromptOutcome; platform: string }>
}

export type InstallPromptState = {
  /** The held event, or null if the browser has not offered one. */
  deferred: BeforeInstallPromptEvent | null
  /** True once `appinstalled` has fired in this tab. */
  installed: boolean
}

/**
 * REPLACED, NEVER MUTATED. This store is read through `useSyncExternalStore`,
 * which compares snapshots by identity and bails out of the re-render when they
 * match — so mutating a single object in place would announce a change that
 * React would then correctly decide was not one, and the button would never
 * appear. Every transition builds a new object.
 */
let state: InstallPromptState = { deferred: null, installed: false }

/** The snapshot the SERVER renders, and the one the client hydrates against.
 *  A constant, because two different objects with the same contents would be
 *  an infinite render loop rather than a mismatch warning. */
const SERVER_STATE: InstallPromptState = { deferred: null, installed: false }

const listeners = new Set<() => void>()
let capturing = false

const announce = () => { for (const fn of listeners) fn() }

/** Registers the window listeners. Safe to call repeatedly; only the first
 *  call does anything. */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === 'undefined') return
  capturing = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    state = { ...state, deferred: e as BeforeInstallPromptEvent }
    announce()
  })
  window.addEventListener('appinstalled', () => {
    /* The event cannot be re-used and there is nothing left to install. */
    state = { deferred: null, installed: true }
    announce()
  })
}

export const installPromptSnapshot = (): InstallPromptState => state
export const serverInstallPromptSnapshot = (): InstallPromptState => SERVER_STATE

export function subscribeToInstallPrompt(fn: () => void): () => void {
  /* Belt and braces: the layout mounts the capture, but a page that reads this
     store without the layout having run would otherwise subscribe to a store
     nothing feeds. */
  captureInstallPrompt()
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * Shows the browser's install dialog and reports what the reader chose.
 * Returns 'unavailable' when there was no event to show — the caller must
 * never have rendered a button in that case, and this is the backstop.
 */
export async function showInstallPrompt(): Promise<PromptOutcome | 'unavailable'> {
  const event = state.deferred
  if (!event) return 'unavailable'
  /* Dropped BEFORE awaiting, not after: the dialog is modal to the page but
     not to this module, and a second click while it is open would call
     `prompt()` on a consumed event. */
  state = { ...state, deferred: null }
  announce()
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    return 'unavailable'
  }
}

/**
 * Whether this document is running as an installed app rather than in a
 * browser tab. `display-mode: standalone` is what Android and desktop report;
 * `navigator.standalone` is the iOS-only spelling, which predates the media
 * query and is still the only signal Safari gives.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosLegacy = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosLegacy
    || window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
}

/**
 * Display mode as an external store, so a component can read it through
 * `useSyncExternalStore` rather than by writing state from inside an effect.
 * The distinction is not bookkeeping: display mode is a fact about the window
 * that React does not own, it is FALSE on the server by definition, and the
 * hook is the one primitive that renders the server's answer during hydration
 * and the browser's answer immediately after — with no mismatch and no frame
 * of state that was never true.
 *
 * It genuinely changes, which is the other reason to subscribe rather than read
 * once: a desktop Chromium window can be installed while it is open, and the
 * tab it was installed from switches to standalone underneath the page.
 */
export function subscribeToDisplayMode(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const queries = ['standalone', 'fullscreen', 'minimal-ui']
    .map((mode) => window.matchMedia(`(display-mode: ${mode})`))
  for (const q of queries) q.addEventListener('change', fn)
  return () => { for (const q of queries) q.removeEventListener('change', fn) }
}

/** The server's answer, and the value hydration matches against: a document
 *  rendered on a server is not running as an installed app. */
export const notStandalone = (): boolean => false

/**
 * A subscribe function for values that cannot change after load — the device's
 * touch capability, below. `useSyncExternalStore` still does the useful half of
 * its job with it: server snapshot during hydration, browser snapshot straight
 * after.
 */
export const subscribeNever = (): (() => void) => () => {}

/**
 * THE IPAD, WHICH LOOKS EXACTLY LIKE A LAPTOP TO A SERVER. It asks for desktop
 * sites by default and sends a Macintosh user agent; the only thing that gives
 * it away is a touch screen, and only in the browser. Both halves are required:
 * `maxTouchPoints` alone would catch every touchscreen Windows laptop, and
 * those are running desktop browsers where the Share-sheet instructions would
 * be nonsense.
 */
export function isDesktopClassTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}
