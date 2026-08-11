/**
 * A QR ENCODER, IN THE REPO, BECAUSE THE ALTERNATIVE IS SOMEBODY ELSE'S DOMAIN.
 *
 * The obvious way to put a QR code on /install is
 * `<img src="https://api.qrserver.com/…?data=https://checkitdown.com/install">`.
 * It is one line and it is wrong here for two reasons that are not about taste:
 *
 *   1. IT IS A DEPENDENCY WITH NO GATE. The page whose entire job is "this is
 *      us, install it" would render a blank box the day that host has an
 *      outage, and no probe in this repo could tell the difference between
 *      "the QR is wrong" and "the QR did not arrive".
 *   2. IT IS A BEACON. Every scan-curious reader's browser announces to a third
 *      party that somebody is looking at our install page, and the URL being
 *      encoded — our own install path — travels in the query string. On a page
 *      asking for trust, that is the wrong trade for a line of code.
 *
 * The third option, an npm QR library, avoids both but adds a few thousand
 * lines nobody in this repo has read to produce ~180 that can be read in one
 * sitting. The encoder is small because it does one job: BYTE MODE, versions 1
 * to 10. That covers any URL up to 271 characters, which is 240 more than the
 * one we encode.
 *
 * WHAT IS DELIBERATELY NOT HERE: numeric/alphanumeric/kanji modes, versions 11
 * to 40, and ECI. Byte mode encodes anything the other modes can, only larger,
 * and a URL is not large. Adding modes would mean adding the tables and the
 * mode-switching optimiser that go with them — all untested, all for a symbol
 * that already fits in 29×29.
 *
 * THE TABLES BELOW ARE NOT TRUSTED, THEY ARE CHECKED. `lib/qr.test.mjs` asserts
 * that data codewords + error-correction codewords equal the version total for
 * all forty (version, level) pairs, and that the total itself equals the number
 * of free modules the geometry actually leaves. A transcription slip in any of
 * the three tables breaks that identity — which is the failure mode that
 * matters, because a QR built from a wrong table still renders as a tidy square
 * of dots and simply does not scan.
 *
 * Reference: ISO/IEC 18004. The structure follows the same shape as Nayuki's
 * public-domain reference implementation, which is the clearest published
 * account of the placement and masking rules.
 */

export type Ecc = 'L' | 'M' | 'Q' | 'H'

/** The highest version this file's tables cover. 10 is 57×57 modules. */
export const MAX_VERSION = 10

/* Total codewords — data plus error correction — for versions 1..10. Index 0 is
   unused so the array can be indexed by version number directly. */
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346]

/**
 * Per version and level: [ecPerBlock, blocksInGroup1, dataPerBlockInGroup1,
 * blocksInGroup2, dataPerBlockInGroup2]. Group 2's blocks, when present, hold
 * exactly one codeword more than group 1's — that is a property of the format,
 * and the test asserts it rather than assuming it.
 */
const BLOCKS: Record<Ecc, number[][]> = {
  L: [[], [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0],
    [26, 1, 108, 0, 0], [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0],
    [30, 2, 116, 0, 0], [18, 2, 68, 2, 69]],
  M: [[], [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0], [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]],
  Q: [[], [13, 1, 13, 0, 0], [22, 1, 22, 0, 0], [18, 2, 17, 0, 0], [26, 2, 24, 0, 0],
    [18, 2, 15, 2, 16], [24, 4, 19, 0, 0], [18, 2, 14, 4, 15], [22, 4, 18, 2, 19],
    [20, 4, 16, 4, 17], [24, 6, 19, 2, 20]],
  H: [[], [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0],
    [22, 2, 11, 2, 12], [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15],
    [24, 4, 12, 4, 13], [28, 6, 15, 2, 16]],
}

/* Alignment-pattern centre coordinates per version. Every pair of coordinates
   gets a pattern except the three that would sit on a finder. */
const ALIGNMENT = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
]

/* The two-bit level indicator that goes into the format information. It is NOT
   the obvious L=0,M=1,Q=2,H=3 — the spec orders them M,L,H,Q — and getting it
   wrong produces a symbol that decodes as the wrong level and fails its own
   error correction. */
const ECC_INDICATOR: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 }

export const ECC_LEVELS: readonly Ecc[] = ['L', 'M', 'Q', 'H']

/* ── GF(256), the field the error correction lives in ─────────────────────── */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    /* Multiply by the primitive element and reduce modulo x^8+x^4+x^3+x^2+1. */
    x = (x << 1) ^ ((x >> 7) * 0x11d)
    x &= 0xff
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** The generator polynomial for `degree` error-correction codewords, highest
 *  power first. Its leading coefficient is always 1, which is what lets the
 *  division below skip a multiply. */
function generator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

/** Polynomial remainder of `data` divided by the degree-`n` generator: the
 *  error-correction codewords for one block. */
function ecCodewords(data: number[], n: number): number[] {
  const gen = generator(n)
  const res = new Array<number>(data.length + n).fill(0)
  for (let i = 0; i < data.length; i++) res[i] = data[i]
  for (let i = 0; i < data.length; i++) {
    const factor = res[i]
    if (factor === 0) continue
    for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j], factor)
  }
  return res.slice(data.length)
}

/* ── Geometry ─────────────────────────────────────────────────────────────── */

export const sizeOf = (version: number): number => 17 + 4 * version

/** Data codewords available at this version and level, after error correction
 *  has taken its share. */
export function dataCapacity(version: number, ecc: Ecc): number {
  const [, b1, d1, b2, d2] = BLOCKS[ecc][version]
  return b1 * d1 + b2 * d2
}

export const totalCodewords = (version: number): number => TOTAL_CODEWORDS[version]

export const blockSpec = (version: number, ecc: Ecc): number[] => BLOCKS[ecc][version]

/** Byte mode's character-count indicator is 8 bits below version 10 and 16 bits
 *  from 10 up. This is the only version-dependent field in the header. */
const countBits = (version: number): number => (version < 10 ? 8 : 16)

/**
 * The modules the format reserves: finders, separators, timing, alignment,
 * the format-information strips, the dark module, and the version block on
 * version 7 and up. Everything else carries data.
 *
 * Exported because `lib/qr-decode.ts` needs the same map to know which modules
 * to skip when it reads the symbol back. That IS a shared assumption between
 * the encoder and the decoder, and the round-trip test cannot see a mistake in
 * it — so it is checked separately, by counting the free modules and asserting
 * they come to exactly `totalCodewords(version)` eight-bit codewords plus the
 * format's stated remainder bits.
 */
export function reservedMap(version: number): boolean[][] {
  const size = sizeOf(version)
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const reserve = (col: number, row: number) => {
    if (col >= 0 && col < size && row >= 0 && row < size) fn[row][col] = true
  }

  /* Finders and their separators: an 8×8 reserved square at three corners. */
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) reserve(cx + dx, cy + dy)
  }
  /* Timing patterns run the full width and height on row and column 6. */
  for (let i = 0; i < size; i++) { reserve(6, i); reserve(i, 6) }
  /* Alignment patterns, 5×5, everywhere two coordinates meet except on a
     finder. */
  const pos = ALIGNMENT[version]
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) reserve(pos[i] + dx, pos[j] + dy)
    }
  }
  /* Format information: two copies, plus the module that is always dark. */
  for (let i = 0; i <= 8; i++) { reserve(8, i); reserve(i, 8) }
  for (let i = 0; i < 8; i++) { reserve(8, size - 1 - i); reserve(size - 1 - i, 8) }
  /* Version information, 6×3 twice, from version 7. */
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      reserve(a, b)
      reserve(b, a)
    }
  }
  return fn
}

/* ── Masking ──────────────────────────────────────────────────────────────── */

/** The eight mask conditions, in the spec's order. Index IS the mask number. */
export const MASKS: ReadonlyArray<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

/**
 * The four penalty rules, which exist to keep a symbol from looking like its
 * own finder patterns or from being so lopsided that a scanner's threshold
 * misreads it. The mask with the lowest total wins.
 */
function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0

  /* Rule 1: a run of five or more identical modules costs 3, plus 1 per extra. */
  for (const byRow of [true, false]) {
    for (let a = 0; a < size; a++) {
      let run = 1
      let prev = byRow ? m[a][0] : m[0][a]
      for (let b = 1; b < size; b++) {
        const v = byRow ? m[a][b] : m[b][a]
        if (v === prev) { run++ } else { if (run >= 5) score += 3 + (run - 5); run = 1; prev = v }
      }
      if (run >= 5) score += 3 + (run - 5)
    }
  }
  /* Rule 2: every 2×2 block of one colour costs 3. */
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c]
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3
    }
  }
  /* Rule 3: the finder-lookalike 1:1:3:1:1 with four light modules on either
     side, in a row or a column, costs 40 each. */
  const A = [true, false, true, true, true, false, true, false, false, false, false]
  const B = [false, false, false, false, true, false, true, true, true, false, true]
  const at = (byRow: boolean, a: number, b: number) => (byRow ? m[a][b] : m[b][a])
  for (const byRow of [true, false]) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 11 <= size; b++) {
        let ma = true; let mb = true
        for (let k = 0; k < 11; k++) {
          const v = at(byRow, a, b + k)
          if (v !== A[k]) ma = false
          if (v !== B[k]) mb = false
        }
        if (ma) score += 40
        if (mb) score += 40
      }
    }
  }
  /* Rule 4: 10 points per 5% that the dark proportion strays from half. */
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++
  const pct = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(pct - 50) / 5) * 10
  return score
}

/* ── Format and version information ───────────────────────────────────────── */

/** BCH(15,5) over the level and mask, XOR-ed with the spec's constant so an
 *  all-zero symbol is not a valid format string. */
export function formatBits(ecc: Ecc, mask: number): number {
  const data = (ECC_INDICATOR[ecc] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** BCH(18,6) over the version number, for versions 7 and up. */
function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

/* ── The encoder ──────────────────────────────────────────────────────────── */

/** Smallest version whose byte-mode capacity holds `byteLength` at this level. */
export function pickVersion(byteLength: number, ecc: Ecc): number {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const bits = 4 + countBits(v) + byteLength * 8
    if (bits <= dataCapacity(v, ecc) * 8) return v
  }
  throw new Error(
    `${byteLength} bytes does not fit a version-${MAX_VERSION} symbol at level ${ecc}`,
  )
}

/** The bit stream for one byte-mode segment, padded to the version's capacity. */
function dataBits(bytes: Uint8Array, version: number, ecc: Ecc): number[] {
  const capacityBits = dataCapacity(version, ecc) * 8
  const bits: number[] = []
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, countBits(version))
  for (const b of bytes) push(b, 8)

  /* Terminator: up to four zeros, fewer if the symbol is nearly full. */
  push(0, Math.min(4, capacityBits - bits.length))
  /* Then to a byte boundary, then the two alternating pad codewords. The pad
     bytes are specified values rather than zeros so a truncated read is
     obviously padding and not data. */
  while (bits.length % 8 !== 0) bits.push(0)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8)
  return bits
}

/** Split into blocks, error-correct each, then interleave into the final
 *  codeword stream. Interleaving is what makes a scratch across the symbol
 *  damage a little of every block instead of destroying one outright. */
function interleave(bits: number[], version: number, ecc: Ecc): number[] {
  const [ecLen, b1, d1, b2, d2] = BLOCKS[ecc][version]
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    codewords.push(byte)
  }

  const blocks: number[][] = []
  const ecBlocks: number[][] = []
  let at = 0
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2
    const block = codewords.slice(at, at + len)
    at += len
    blocks.push(block)
    ecBlocks.push(ecCodewords(block, ecLen))
  }

  const out: number[] = []
  const longest = Math.max(d1, d2)
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i])
  }
  for (let i = 0; i < ecLen; i++) for (const block of ecBlocks) out.push(block[i])
  return out
}

/**
 * The finished module matrix: `true` is a dark module. Row-major, so
 * `matrix[row][col]`, origin at the top-left. No quiet zone — that is the
 * renderer's job, and a matrix carrying four rows of nothing on every side
 * would be a matrix every consumer has to trim.
 */
export function qrMatrix(text: string, opts: { ecc?: Ecc; minVersion?: number } = {}): boolean[][] {
  const ecc = opts.ecc ?? 'Q'
  const bytes = new TextEncoder().encode(text)
  const version = Math.max(pickVersion(bytes.length, ecc), opts.minVersion ?? 1)
  const size = sizeOf(version)
  const fn = reservedMap(version)
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (col: number, row: number, dark: boolean) => { m[row][col] = dark }

  /* Finders. The 7×7 pattern is a ring, a gap, and a 3×3 core. */
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        set(cx + dx, cy + dy, edge || core)
      }
    }
  }
  /* Timing: alternating modules, dark on even coordinates. */
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  /* Alignment: a 5×5 ring with a single dark centre. */
  const pos = ALIGNMENT[version]
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }
  /* The module below the top-left format strip is always dark. */
  set(8, size - 8, true)
  if (version >= 7) {
    const vb = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const bit = ((vb >> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }

  /* Data, laid in two-module columns snaking up and down from the bottom
     right. Column 6 is skipped whole: it is the vertical timing pattern. */
  const bits = interleave(dataBits(bytes, version, ecc), version, ecc)
  let bit = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j
        const row = upward ? size - 1 - vert : vert
        if (fn[row][col]) continue
        /* Past the end of the stream the remaining modules stay light — those
           are the format's remainder bits, which carry nothing. */
        const byteAt = bit >> 3
        m[row][col] = byteAt < bits.length && ((bits[byteAt] >> (7 - (bit & 7))) & 1) === 1
        bit++
      }
    }
    upward = !upward
  }

  /* Every mask is applied, scored and the best kept. Trying all eight is the
     spec's own instruction and costs microseconds at this size. */
  let best = -1
  let bestScore = Infinity
  let bestMatrix: boolean[][] = m
  for (let mask = 0; mask < 8; mask++) {
    const candidate = m.map((row) => row.slice())
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!fn[r][c] && MASKS[mask](r, c)) candidate[r][c] = !candidate[r][c]
      }
    }
    writeFormat(candidate, ecc, mask)
    const s = penalty(candidate)
    if (s < bestScore) { bestScore = s; best = mask; bestMatrix = candidate }
  }
  if (best < 0) throw new Error('no mask was selected')
  return bestMatrix
}

/** Both copies of the 15-bit format string, written into a candidate matrix. */
function writeFormat(m: boolean[][], ecc: Ecc, mask: number): void {
  const size = m.length
  const bits = formatBits(ecc, mask)
  const bitAt = (i: number) => ((bits >> i) & 1) === 1
  const set = (col: number, row: number, dark: boolean) => { m[row][col] = dark }

  for (let i = 0; i <= 5; i++) set(8, i, bitAt(i))
  set(8, 7, bitAt(6))
  set(8, 8, bitAt(7))
  set(7, 8, bitAt(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bitAt(i))

  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitAt(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitAt(i))
  set(8, size - 8, true)
}
