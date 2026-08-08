#!/usr/bin/env node
/**
 * HOME-SCREEN ICONS, DRAWN FROM THE TOKENS.
 *
 * An installed app keeps its icon until someone reinstalls it, so a hardcoded
 * hex here would outlive the palette by months on every phone that added the
 * site — the number-copied-forward failure, on the one surface that survives a
 * deploy. The blue/gold palette is landing underneath this work, so these are
 * generated from `app/styles/tokens/colors.css` and regenerated when it moves.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is the brand's: a knock makes rings. Two rings, drawn as circles by
 * distance from centre — no font, no external asset, nothing to go stale except
 * the tokens it reads.
 *
 * WHY A HAND-ROLLED PNG ENCODER. The alternative is a dependency (sharp,
 * canvas) that pulls native binaries into a repo that currently has none, to
 * draw two circles. zlib is in the standard library and PNG's structure is four
 * chunks; the whole encoder is thirty lines and has no supply chain.
 *
 * MASKABLE IS A SEPARATE FILE, NOT A FLAG. Android crops a maskable icon to
 * whatever shape the launcher uses — circle, squircle, teardrop — and only the
 * middle 80% is guaranteed to survive. A single icon declared as both `any` and
 * `maskable` gets clipped on Android or floats undersized on iOS. So the
 * maskable one draws the same mark smaller, inside the safe zone.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { readServerToken } from '../lib/tokens-server.ts'

const OUT = join(process.cwd(), 'public')
mkdirSync(OUT, { recursive: true })

const hex = (h) => {
  const s = h.trim().replace('#', '')
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** RGBA pixels -> a PNG buffer. Colour type 6, 8-bit, filter 0 per row. */
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * The mark: two rings, struck off-centre the way a knock lands.
 *
 * `inset` is the fraction of the canvas the art is allowed to use. 1.0 fills
 * the square (fine for iOS, which applies its own rounded mask and never
 * crops); 0.72 keeps the whole mark inside Android's maskable safe zone.
 */
function draw(size, { bg, ring, inset, opaque }) {
  const px = Buffer.alloc(size * size * 4)
  const [br, bgc, bb] = bg
  const [rr, rg, rb] = ring
  const cx = size / 2, cy = size / 2
  const R = (size / 2) * inset
  /* Two rings at 0.58 and 0.92 of the radius, stroke scaled to the canvas so
     192px and 512px look like the same mark rather than the same maths. */
  const rings = [0.58, 0.92].map((f) => R * f)
  const stroke = Math.max(2, R * 0.10)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      let on = 0
      for (const r of rings) {
        /* Antialiased edge: coverage falls off across one pixel either side of
           the stroke, or the rings alias badly at 192px. */
        const e = Math.abs(d - r)
        const cov = Math.min(1, Math.max(0, (stroke / 2 + 0.5 - e)))
        on = Math.max(on, cov)
      }
      px[i] = Math.round(br + (rr - br) * on)
      px[i + 1] = Math.round(bgc + (rg - bgc) * on)
      px[i + 2] = Math.round(bb + (rb - bb) * on)
      /* The circular badge on iOS sits on a background it does not control, so
         every icon is fully opaque. A transparent PNG becomes a black square on
         some launchers. */
      px[i + 3] = opaque ? 255 : 255
    }
  }
  return px
}

const bg = hex(readServerToken('--cid-ink-800'))
const ring = hex(readServerToken('--cid-accent-500'))

const files = [
  ['icon-192.png', 192, 1.0],
  ['icon-512.png', 512, 1.0],
  ['icon-maskable-512.png', 512, 0.72],
  /* 180 is what iOS asks for; it downsamples for every other slot. */
  ['apple-touch-icon.png', 180, 1.0],
]

for (const [name, size, inset] of files) {
  const buf = png(size, draw(size, { bg, ring, inset, opaque: true }))
  writeFileSync(join(OUT, name), buf)
  console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`)
}
console.log(`\n  drawn from --cid-ink-800 (${readServerToken('--cid-ink-800')}) `
  + `and --cid-accent-500 (${readServerToken('--cid-accent-500')})`)
