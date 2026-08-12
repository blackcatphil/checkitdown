import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readServerToken } from './tokens-server.ts'

/**
 * THE SHARE CARD'S MATERIALS — fonts, artwork and colours, in one place.
 *
 * Split out of the image itself because there will be more than one image. The
 * generic card is the only one built today; a room card and a tournament card
 * are proposed and would need exactly these three things, and three copies of
 * the font-loading boilerplate is how two of them end up on the old palette.
 *
 * ⚠️ EVERY COLOUR IS READ FROM `app/styles/tokens/colors.css`, never pasted.
 * A share image is the artefact with the longest half-life in this whole
 * product: platforms cache an unfurl for weeks and a link already shared keeps
 * its picture indefinitely. A hex pasted here would outlive the palette on
 * every link anyone ever posted — the same failure the icon generator was
 * written to prevent, on a surface with an even longer memory.
 */

const ASSETS = join(process.cwd(), 'scripts', 'assets')

/**
 * ⚠️ THE REAL FACES, BUNDLED — NOT A LOOKALIKE.
 *
 * Instrument Serif has no bold and a substituted serif would fake one; IBM Plex
 * Mono's wide tracking at label sizes is the product's voice. Both are read off
 * disk rather than fetched at render time: an image route that reaches the
 * network to draw itself fails the day Google's CDN is slow, and it fails
 * INSIDE a crawler that will cache whatever it got — including nothing.
 */
export const fonts = () => [
  {
    name: 'Instrument Serif',
    data: readFileSync(join(ASSETS, 'InstrumentSerif-Regular.ttf')),
    weight: 400 as const,
    style: 'normal' as const,
  },
  {
    name: 'IBM Plex Mono',
    data: readFileSync(join(ASSETS, 'IBMPlexMono-SemiBold.ttf')),
    weight: 600 as const,
    style: 'normal' as const,
  },
]

/**
 * The mark, as a data URI.
 *
 * `public/icon-512.png` rather than the 64px header copy: this draws at ~150px
 * and upscaling the small one would ship a soft logo on the one image that is
 * only ever seen at full size. Same artwork, same generator
 * (`scripts/make-icons.py`), so the card cannot drift from the tab.
 *
 * Inlined rather than referenced by URL because an ImageResponse fetching its
 * own origin is a request the crawler is not making and the server may not be
 * able to answer during a build.
 */
export const markDataUri = (): string =>
  `data:image/png;base64,${readFileSync(join(process.cwd(), 'public', 'icon-512.png')).toString('base64')}`

export const OG_SIZE = { width: 1200, height: 630 }

/** The palette, resolved once per render. */
export const ogColors = () => ({
  ink: readServerToken('--cid-ink-800'),
  surface: readServerToken('--cid-ink-700'),
  paper: readServerToken('--cid-paper'),
  dim: readServerToken('--cid-unverified'),
  gold: readServerToken('--cid-gold-500'),
  goldLine: readServerToken('--cid-gold-300'),
  accent: readServerToken('--cid-accent-500'),
})

/**
 * ⚠️ WHY THERE IS NO ROOM COUNT ON THIS CARD.
 *
 * The header says "17 ROOMS · VERIFIED DAILY" and the obvious card copies it.
 * It must not, and "derive it at request time" is not the fix either.
 *
 * A share image is CACHED BY THE PLATFORM, not by us. Slack, X, Discord and
 * iMessage each fetch the image once per URL and keep it — for weeks, and for a
 * link already posted, effectively forever. So a count derived at request time
 * is correct exactly once, at first unfurl, and is then frozen in somebody
 * else's cache behaving precisely like a baked-in number — while looking live,
 * which is worse than looking static.
 *
 * There is no version of a volatile figure on this surface that stays true. So
 * the card carries only claims that do not go stale: what the product is, and
 * that every fact on it has a source and a date. Both are as true at 19 rooms
 * as at 17.
 *
 * THE SAME REASONING DOES NOT APPLY TO A ROOM CARD's verified date, if one is
 * ever built — that date is a fact ABOUT THE SNAPSHOT the card depicts, and a
 * cached card showing the date it was cached is honest rather than stale. It
 * still inherits the treatment rules: tilde'd if unverified, "unknown" if
 * unknown. See the proposal in the report.
 */
/**
 * THE CARD'S COPY, AS DATA — so "no typed figures" is a check rather than a
 * habit. `lib/og.test.mjs` asserts every string here is free of digits, which
 * is a test a reviewer cannot forget to run and a regex over the whole TSX
 * could never make precisely (that file is full of legitimate numbers: 1200,
 * 630, font sizes, padding).
 *
 * Anything rendered as words on the generic card belongs in here. A line added
 * straight into the JSX would escape the gate, which is why the JSX reads from
 * this and holds no literal copy of its own.
 */
export const OG_LINES = {
  headline: 'Check It Down',
  claim: 'Every poker room in the Las Vegas valley, ranked on what is actually verified.',
  promise: 'EVERY FACT CARRIES A SOURCE AND A DATE',
  stance: 'INDEPENDENT',
} as const
