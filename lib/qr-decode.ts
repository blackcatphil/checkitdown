/**
 * A QR DECODER, WRITTEN SO THE PROBE DOES NOT HAVE TO TRUST THE GENERATOR.
 *
 * An unscannable QR code is invisible to every other check in this repo. It
 * renders as a tidy square of dots, it has the right dimensions, its contrast
 * passes the palette gate, and it fails only in a phone camera that no CI run
 * holds. A generator with a transposed table produces exactly that: a picture
 * of a QR code.
 *
 * So `scripts/pwa-probe.mjs` decodes the symbol back out of RENDERED PIXELS —
 * it screenshots what the browser drew, thresholds it, finds the module grid
 * from the finder pattern, and reads the URL out. That path shares no code with
 * the SVG renderer, so it catches a wrong URL, a wrong colour pair, a clipped
 * edge, a missing quiet zone and a CSS rule that scaled the symbol to a
 * fractional module width — none of which the encoder can see.
 *
 * WHAT IT SHARES WITH THE ENCODER, STATED PLAINLY: `reservedMap` and the mask
 * functions, both imported from `lib/qr.ts`. Duplicating a hundred lines of
 * geometry to be able to claim independence would mean two copies to keep
 * right and would still not be independent in any way that matters. The
 * geometry is checked directly instead — `lib/qr.test.mjs` counts the free
 * modules the map leaves and asserts they equal the codeword count the format
 * specifies, which is a fact about the spec rather than a fact about this code.
 *
 * NO ERROR CORRECTION. The error-correction codewords are read past, not used.
 * That is deliberate: this decoder's job is to prove the symbol is CORRECT, and
 * Reed-Solomon correction would let a symbol with real damage decode cleanly
 * and pass. A phone's decoder will repair a scuff on a printed sheet; a probe
 * that repairs the generator's mistakes is a probe that cannot fail.
 */

import { MASKS, blockSpec, reservedMap, type Ecc } from './qr.ts'

/** Same order as the two-bit indicator in the format string. */
const ECC_BY_INDICATOR: Ecc[] = ['M', 'L', 'H', 'Q']

/** The 32 legal format strings, by [indicator, mask]. Recomputed rather than
 *  imported as a table so a corrupted read can be matched to the nearest. */
function legalFormats(): Array<{ bits: number; ecc: Ecc; mask: number }> {
  const out: Array<{ bits: number; ecc: Ecc; mask: number }> = []
  for (let indicator = 0; indicator < 4; indicator++) {
    for (let mask = 0; mask < 8; mask++) {
      const data = (indicator << 3) | mask
      let rem = data
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
      out.push({ bits: ((data << 10) | rem) ^ 0x5412, ecc: ECC_BY_INDICATOR[indicator], mask })
    }
  }
  return out
}

const popcount = (n: number): number => {
  let c = 0
  for (let i = 0; i < 15; i++) c += (n >> i) & 1
  return c
}

export type Decoded = {
  text: string
  version: number
  ecc: Ecc
  mask: number
}

/**
 * Read a module matrix — `true` is dark, row-major, no quiet zone — back to the
 * string it encodes. Throws with a specific reason rather than returning null:
 * every caller here is a test, and "which part was wrong" is the whole value.
 */
export function decodeMatrix(m: boolean[][]): Decoded {
  const size = m.length
  if (size < 21 || (size - 17) % 4 !== 0) throw new Error(`not a QR size: ${size}`)
  const version = (size - 17) / 4

  /* The format string, from the copy beside the top-left finder, in the same
     bit order the encoder wrote it. */
  let read = 0
  const bitAt = (col: number, row: number) => (m[row][col] ? 1 : 0)
  const put = (i: number, v: number) => { read |= v << i }
  for (let i = 0; i <= 5; i++) put(i, bitAt(8, i))
  put(6, bitAt(8, 7))
  put(7, bitAt(8, 8))
  put(8, bitAt(7, 8))
  for (let i = 9; i < 15; i++) put(i, bitAt(14 - i, 8))

  /* Nearest legal format string wins. A perfect symbol matches at distance 0;
     anything else is reported so a near-miss cannot pass as clean. */
  let best: { bits: number; ecc: Ecc; mask: number } | null = null
  let bestDistance = 99
  for (const f of legalFormats()) {
    const d = popcount(f.bits ^ read)
    if (d < bestDistance) { bestDistance = d; best = f }
  }
  if (!best || bestDistance > 3) throw new Error(`format information is unreadable (distance ${bestDistance})`)
  if (bestDistance !== 0) throw new Error(`format information needed correction (distance ${bestDistance}) — the symbol is damaged`)
  const { ecc, mask } = best

  /* Unmask, then read the data modules in the encoder's snaking order. */
  const fn = reservedMap(version)
  const bits: number[] = []
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j
        const row = upward ? size - 1 - vert : vert
        if (fn[row][col]) continue
        const dark = MASKS[mask](row, col) ? !m[row][col] : m[row][col]
        bits.push(dark ? 1 : 0)
      }
    }
    upward = !upward
  }

  const stream: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    stream.push(byte)
  }

  /* De-interleave. The encoder walked block-by-block for each index; this walks
     the same path and hands each codeword back to the block it came from. */
  const [ecLen, b1, d1, b2, d2] = blockSpec(version, ecc)
  const expected = b1 * d1 + b2 * d2 + ecLen * (b1 + b2)
  if (stream.length < expected) {
    throw new Error(`symbol holds ${stream.length} codewords, the format wants ${expected}`)
  }
  const blocks: number[][] = []
  for (let i = 0; i < b1 + b2; i++) blocks.push([])
  let at = 0
  const longest = Math.max(d1, d2)
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < blocks.length; b++) {
      const len = b < b1 ? d1 : d2
      if (i < len) blocks[b].push(stream[at++])
    }
  }
  const data = blocks.flat()

  /* The data bit stream: mode, length, then the bytes. */
  let p = 0
  const take = (n: number) => {
    let v = 0
    for (let i = 0; i < n; i++) {
      const byte = data[(p + i) >> 3]
      v = (v << 1) | ((byte >> (7 - ((p + i) & 7))) & 1)
    }
    p += n
    return v
  }
  const mode = take(4)
  if (mode !== 0b0100) throw new Error(`mode ${mode.toString(2).padStart(4, '0')} is not byte mode`)
  const length = take(version < 10 ? 8 : 16)
  if (length > data.length - 2) throw new Error(`declared length ${length} exceeds the symbol`)
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) bytes[i] = take(8)
  return { text: new TextDecoder().decode(bytes), version, ecc, mask }
}

/* ── From pixels ──────────────────────────────────────────────────────────── */

export type Luma = { data: Uint8Array | number[]; width: number; height: number }

/**
 * Find the symbol in a rendered image and sample its modules.
 *
 * Deliberately narrow: the image is assumed to be axis-aligned and unrotated,
 * which is true of anything a browser drew from our own SVG and is NOT true of
 * a photograph. A perspective-correcting locator would be several hundred lines
 * to handle a case that cannot occur here.
 *
 * The steps are the honest ones a scanner takes:
 *   1. threshold to black and white
 *   2. the dark bounding box IS the symbol — finders sit in three corners, so
 *      they pin all four edges
 *   3. the leading dark run on the symbol's top edge is the top-left finder,
 *      which is SEVEN modules wide by definition. That gives the module size,
 *      and therefore the version, from the picture rather than from us.
 *   4. sample each module at its centre
 */
export function matrixFromLuma(img: Luma): { matrix: boolean[][]; moduleSize: number; box: { left: number; top: number; right: number; bottom: number } } {
  const { data, width, height } = img
  const darkAt = (x: number, y: number) => data[y * width + x] < 128

  let left = width; let right = -1; let top = height; let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!darkAt(x, y)) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) throw new Error('no dark pixels — nothing was rendered')

  const span = right - left + 1
  const tall = bottom - top + 1
  if (Math.abs(span - tall) > 2) throw new Error(`the symbol is not square: ${span}x${tall}`)

  /* The finder's run, measured a couple of pixels inside the top edge so an
     anti-aliased boundary row cannot shorten it. */
  const probeRow = top + Math.max(1, Math.round(span * 0.01))
  let run = 0
  while (left + run <= right && darkAt(left + run, probeRow)) run++
  if (run < 7) throw new Error(`the top-left finder measured ${run}px — too small to sample`)
  const moduleSize = run / 7
  const n = Math.round(span / moduleSize)
  if (n < 21 || (n - 17) % 4 !== 0) throw new Error(`derived a ${n}-module symbol, which is not a QR size`)

  const matrix: boolean[][] = []
  for (let r = 0; r < n; r++) {
    const row: boolean[] = []
    for (let c = 0; c < n; c++) {
      const x = Math.min(width - 1, Math.round(left + ((c + 0.5) * span) / n))
      const y = Math.min(height - 1, Math.round(top + ((r + 0.5) * tall) / n))
      row.push(darkAt(x, y))
    }
    matrix.push(row)
  }
  return { matrix, moduleSize, box: { left, top, right, bottom } }
}
