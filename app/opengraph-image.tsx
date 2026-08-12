import { ImageResponse } from 'next/og'

import { OG_LINES, OG_SIZE, fonts, markDataUri, ogColors } from '@/lib/og'

/**
 * THE SHARE CARD. 1200×630, the size every platform crops from.
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * There was no OpenGraph anything: no metadata block, no image, nothing in the
 * rendered head. Every share of checkitdown.com on iMessage, Slack, X or
 * Discord rendered as a bare URL — no picture, no title card, nothing to say
 * what the link is. On a product meant to be passed between players in a poker
 * room, that is the cheapest visibility on the table and it was zero.
 *
 * ═══ ⚠️ NO FIGURES ON THIS CARD, AND THAT IS A RULING ═══
 *
 * Not "no figures for now". A share image is cached by the PLATFORM: fetched
 * once per URL and kept, for weeks, and for a link already posted effectively
 * forever. A count derived at request time is therefore correct exactly once
 * and then frozen in somebody else's cache, behaving like a baked-in number
 * while looking live. The full argument is in `lib/og.ts`; the short version is
 * that the only figures safe on this surface are the ones that cannot go stale,
 * and a room count is not one of them.
 *
 * So the card says what the product IS and what it PROMISES. Both survive the
 * roster changing.
 */
export const alt = 'Check It Down — every poker room in the Las Vegas valley, '
  + 'with a source and a date on every fact'
export const size = OG_SIZE
export const contentType = 'image/png'

export default async function OpengraphImage() {
  const c = ogColors()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: c.ink,
          padding: '72px 80px',
        }}
      >
        {/* THE LOCKUP — the same artwork as the tab and the header, inlined
            from public/icon-512.png so it cannot drift from either. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {/* A plain <img>, and next/image is not an option here: Satori
              rasterises this JSX itself, with no browser, no DOM and no image
              pipeline. The source is a data URI so nothing is fetched. */}
          <img src={markDataUri()} width={124} height={124} alt="" />
          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument Serif',
              fontSize: 92,
              color: c.paper,
              /* Instrument Serif has no bold and this must not fake one. */
              letterSpacing: '-0.01em',
            }}
          >
            {OG_LINES.headline}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument Serif',
              fontSize: 52,
              color: c.paper,
              lineHeight: 1.15,
              maxWidth: 900,
            }}
          >
            {OG_LINES.claim}
          </div>

          {/* THE ONE GOLD GEOMETRY. A hairline rule is where the palette law
              spends gold: it marks a boundary and claims nothing. */}
          <div style={{ display: 'flex', width: 640, height: 1, background: c.goldLine }} />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              fontFamily: 'IBM Plex Mono',
              fontSize: 25,
              letterSpacing: '0.16em',
              color: c.dim,
            }}
          >
            {/* NO COUNT, DELIBERATELY — see the head of this file. Every word
                here is as true at nineteen rooms as at seventeen. */}
            <span style={{ color: c.gold }}>{OG_LINES.promise}</span>
            <span>·</span>
            <span>{OG_LINES.stance}</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts() },
  )
}
