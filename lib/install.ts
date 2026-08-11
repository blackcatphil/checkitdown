import { SITE_URL } from './site.ts'

/**
 * THE INSTALL PAGE'S OWN ADDRESS, AND THE ONE QUESTION IT HAS TO ANSWER FIRST.
 *
 * The site has been installable since 2026-08-07 — manifest, standalone
 * display, both Android icon sizes plus a maskable one, the meta tags iOS reads
 * instead of the manifest, and a registered service worker. Twenty-three
 * assertions say so. None of that was ever findable: there was no page that
 * said "you can put this on your home screen", so the capability existed and
 * nobody could reach it.
 */

export const INSTALL_PATH = '/install'

/**
 * THE URL THE QR CODE ENCODES, and it encodes the INSTRUCTIONS rather than the
 * map.
 *
 * The tempting choice is `https://checkitdown.com/` — scan it and you are in
 * the app. But somebody scanning a QR code off a laptop screen has not yet
 * installed anything; landing them on the map assumes they already know what to
 * do next, and on iOS what to do next is a two-step gesture inside a menu they
 * have to be told about. Landing on the instructions costs one tap for the
 * person who already knew, and rescues everybody who did not.
 */
export const INSTALL_URL = `${SITE_URL}${INSTALL_PATH}`

export type Platform = 'ios' | 'android' | 'desktop'

export const PLATFORMS: readonly Platform[] = ['ios', 'android', 'desktop']

export const isPlatform = (v: string | undefined | null): v is Platform =>
  v != null && (PLATFORMS as readonly string[]).includes(v)

/**
 * WHICH SET OF INSTRUCTIONS THIS READER GETS. One, never three.
 *
 * Showing all three and letting the reader pick is how a page teaches somebody
 * that none of it is for them: two thirds of what they are reading is about a
 * device they are not holding, and the tax is paid by the reader who is least
 * sure of themselves.
 *
 * SNIFFING THE USER AGENT IS UNRELIABLE AND IS STILL THE RIGHT CALL HERE, for
 * a reason specific to this page: the cost of being wrong is one wrong set of
 * instructions with a visible way to switch, not a broken feature. Deciding on
 * the client instead would mean either a flash of the wrong branch or an empty
 * page until JavaScript runs, on a page a reader arrives at from a QR code on
 * an unfamiliar phone.
 *
 * THE KNOWN WRONG ANSWER, WRITTEN DOWN: iPadOS asks for desktop sites by
 * default and sends a Macintosh user agent. There is no header that gives it
 * away — `navigator.maxTouchPoints` does, and that only exists in the browser.
 * So the server calls it desktop, the client corrects it after mount, and the
 * switcher at the foot of the page is there for every case neither of them
 * gets right.
 */
export function platformFromUserAgent(ua: string | null | undefined): Platform {
  const s = ua ?? ''
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios'
  if (/Android/i.test(s)) return 'android'
  return 'desktop'
}
