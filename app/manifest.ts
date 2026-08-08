import type { MetadataRoute } from 'next'

import { readServerToken } from '@/lib/tokens-server'

/**
 * ADD TO HOME SCREEN. Phil, 2026-08-07: *"most people are going to be using
 * this app on their phone once they leave their rooms."*
 *
 * Mobile-first and PWA were dropped in the 2026-08-03 pivot for SCOPE, not
 * because the reasoning changed — the original scoping said it plainly: no
 * laptops in Vegas. This is that decision coming back, not a new one.
 *
 * COLOURS COME FROM THE TOKENS. `theme_color` paints Android's task-switcher
 * card and the status bar; `background_color` paints the splash screen while
 * the app boots. Both are consumed by the operating system, which cannot
 * resolve a CSS variable, so they have to be strings — and a pasted hex here
 * would survive the blue/gold palette landing underneath this work and keep the
 * old colours on every phone that installed the site. Read from
 * `colors.css` at build time instead.
 *
 * `background_color` is the PAGE, not the accent: the splash screen should look
 * like the app arriving, not like a coloured flash before it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Check It Down — Las Vegas poker rooms',
    /* Home-screen labels get truncated around 12 characters on iOS. "Check It
       Down" fits; the full name would render as "Check It Do…". */
    short_name: 'Check It Down',
    description:
      'Every poker room in the Las Vegas valley, ranked on what is actually verified. '
      + 'Every fact carries a source and a date.',
    /* The map. It is the landing view on the web and it is the answer to
       "where am I and what is near me", which is the question someone has when
       they open this from a home screen. */
    start_url: '/',
    id: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: readServerToken('--cid-ink-800'),
    theme_color: readServerToken('--cid-ink-800'),
    icons: [
      /* 192 and 512 are the two Android actually requires; anything else is
         downsampled from them. */
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      /* SEPARATE FILE, NOT A SECOND PURPOSE ON THE SAME ONE. Android crops a
         maskable icon to the launcher's shape and guarantees only the middle
         80%; declaring one file `any maskable` gets it clipped on Android or
         floating undersized elsewhere. */
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    /* Deep links worth having on a home screen. Both are one tap from the map
       anyway, but a long-press shortcut is the difference between "open the app
       and navigate" and "answer the question". */
    shortcuts: [
      { name: 'Just the facts', short_name: 'Facts', url: '/facts' },
      { name: 'Tournaments', short_name: 'Tournaments', url: '/tournaments' },
    ],
    categories: ['travel', 'utilities'],
    lang: 'en-US',
    dir: 'ltr',
  }
}
