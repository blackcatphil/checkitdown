import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeMatrix, matrixFromLuma } from './qr-decode.ts'
import {
  ECC_LEVELS, MAX_VERSION, blockSpec, dataCapacity, formatBits, pickVersion,
  qrMatrix, reservedMap, sizeOf, totalCodewords,
} from './qr.ts'

/**
 * THE TABLES ARE THE RISK, NOT THE ALGORITHM.
 *
 * A wrong loop throws or produces obvious nonsense. A wrong NUMBER in the
 * block table produces a symbol that looks perfect and does not scan — and the
 * only reader that would ever notice is a phone camera in somebody's hand,
 * which is not a thing CI holds. So the tables are checked against each other
 * and against the geometry, three ways:
 *
 *   - data + error correction = the version's total, for all 40 pairs
 *   - the version's total = the free modules the geometry actually leaves
 *   - a round trip through an independently written decoder
 *
 * The first two are facts about the SPEC. They cannot be satisfied by a
 * consistent misunderstanding on this file's part, because they relate three
 * separately transcribed things.
 */

test('every (version, level) pair: data + error correction = the version total', () => {
  for (let v = 1; v <= MAX_VERSION; v++) {
    for (const ecc of ECC_LEVELS) {
      const [ecLen, b1, d1, b2, d2] = blockSpec(v, ecc)
      const sum = b1 * d1 + b2 * d2 + ecLen * (b1 + b2)
      assert.equal(sum, totalCodewords(v), `version ${v} level ${ecc}: ${sum} != ${totalCodewords(v)}`)
    }
  }
})

test('the second block group, where it exists, holds exactly one codeword more', () => {
  for (let v = 1; v <= MAX_VERSION; v++) {
    for (const ecc of ECC_LEVELS) {
      const [, , d1, b2, d2] = blockSpec(v, ecc)
      if (b2 === 0) { assert.equal(d2, 0); continue }
      assert.equal(d2, d1 + 1, `version ${v} level ${ecc}: group 2 holds ${d2}, group 1 holds ${d1}`)
    }
  }
})

/**
 * THE GEOMETRY CHECK — the one that would have caught a mis-placed alignment
 * pattern or a format strip reserved one module too wide. It counts the modules
 * the layout leaves free and asserts they come to the codeword count the format
 * states, plus the remainder bits the spec allows: 0 for version 1, 7 for
 * versions 2 to 6, 0 again for 7 to 13.
 */
test('the free modules the geometry leaves match the codeword count', () => {
  const REMAINDER = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0]
  for (let v = 1; v <= MAX_VERSION; v++) {
    const fn = reservedMap(v)
    const size = sizeOf(v)
    let free = 0
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c]) free++
    assert.equal(free, totalCodewords(v) * 8 + REMAINDER[v],
      `version ${v}: ${free} free modules, expected ${totalCodewords(v) * 8 + REMAINDER[v]}`)
  }
})

test('the format string is 15 bits and every one of the 32 is distinct', () => {
  const seen = new Set()
  for (const ecc of ECC_LEVELS) {
    for (let mask = 0; mask < 8; mask++) {
      const bits = formatBits(ecc, mask)
      assert.ok(bits >= 0 && bits < 1 << 15, `${ecc}/${mask} produced ${bits}`)
      seen.add(bits)
    }
  }
  assert.equal(seen.size, 32)
})

/**
 * A PINNED VECTOR. Format information is the one field with a published
 * worked example everywhere the standard is described: level M with mask 5
 * encodes to 100000011001110. If the BCH loop or the XOR constant were wrong,
 * every symbol this file makes would be unreadable and every other test here
 * would still pass — the decoder would make the same mistake in reverse.
 */
test('the published format-information vector: level M, mask 5', () => {
  assert.equal(formatBits('M', 5).toString(2).padStart(15, '0'), '100000011001110')
})

test('version selection takes the smallest symbol that fits, and refuses what does not', () => {
  assert.equal(pickVersion(1, 'Q'), 1)
  /* 'https://checkitdown.com/install' is 31 bytes; version 3 at level Q holds
     34 data codewords, less two for the header. */
  assert.equal(pickVersion(31, 'Q'), 3)
  assert.equal(dataCapacity(3, 'Q'), 34)
  assert.throws(() => pickVersion(400, 'H'), /does not fit/)
})

test('the finder patterns are where a scanner looks for them', () => {
  const m = qrMatrix('https://checkitdown.com/install')
  const size = m.length
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    /* Outer ring dark, inner ring light, 3x3 core dark. */
    assert.ok(m[cy][cx], 'finder corner is dark')
    assert.ok(!m[cy + 1][cx + 1], 'finder gap is light')
    assert.ok(m[cy + 3][cx + 3], 'finder core is dark')
  }
  /* The bottom-right corner must NOT hold a fourth finder — that asymmetry is
     how a scanner works out which way up the symbol is. */
  const finder = (cx, cy) => {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        if (m[cy + dy][cx + dx] !== (edge || core)) return false
      }
    }
    return true
  }
  assert.ok(finder(0, 0) && finder(size - 7, 0) && finder(0, size - 7), 'three finders are exact')
  assert.ok(!finder(size - 7, size - 7), 'the bottom-right corner is not a fourth finder')
})

test('the timing patterns alternate the whole way across', () => {
  const m = qrMatrix('https://checkitdown.com/install')
  const size = m.length
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `horizontal timing at ${i}`)
    assert.equal(m[i][6], i % 2 === 0, `vertical timing at ${i}`)
  }
})

test('the module below the top-left format strip is always dark', () => {
  const m = qrMatrix('https://checkitdown.com/install')
  assert.equal(m[m.length - 8][8], true)
})

/* ── Round trips ──────────────────────────────────────────────────────────── */

test('the install URL survives a round trip, at the version and level expected', () => {
  const url = 'https://checkitdown.com/install'
  const decoded = decodeMatrix(qrMatrix(url, { ecc: 'Q' }))
  assert.equal(decoded.text, url)
  assert.equal(decoded.version, 3)
  assert.equal(decoded.ecc, 'Q')
})

test('round trips at every level, and across the multi-block boundary', () => {
  for (const ecc of ECC_LEVELS) {
    /* 100 bytes is the largest that fits every level inside version 10, which
       is where this file's tables stop. It also crosses into the versions that
       split the data across several interleaved blocks — the step that a
       single-block round trip would never exercise. */
    for (const text of ['a', 'https://checkitdown.com/install', 'x'.repeat(60), 'x'.repeat(100)]) {
      const decoded = decodeMatrix(qrMatrix(text, { ecc }))
      assert.equal(decoded.text, text, `level ${ecc}, ${text.length} bytes`)
      assert.equal(decoded.ecc, ecc)
    }
  }
})

test('a version-7 symbol round trips — the version-information block is only written from 7', () => {
  const text = 'x'.repeat(150)
  const decoded = decodeMatrix(qrMatrix(text, { ecc: 'L', minVersion: 7 }))
  assert.ok(decoded.version >= 7, `landed on version ${decoded.version}`)
  assert.equal(decoded.text, text)
})

test('non-ASCII survives, because byte mode carries UTF-8 and the length is in BYTES', () => {
  const text = 'Check It Down — Aria’s $1/3'
  assert.equal(decodeMatrix(qrMatrix(text)).text, text)
})

/**
 * THE NEGATIVE CONTROL. A decoder that returns the right answer for a good
 * symbol proves nothing on its own if it would also return it for a broken one.
 * One flipped data module must be REPORTED, not silently repaired — this
 * decoder deliberately does no error correction, so the round-trip assertions
 * above are measuring the encoder rather than Reed-Solomon covering for it.
 */
test('a flipped data module changes what comes back out', () => {
  const url = 'https://checkitdown.com/install'
  const m = qrMatrix(url)
  /* A real DATA module, found rather than guessed. The first attempt flipped
     (20,20) on a version-3 symbol, which is the corner of the alignment
     pattern centred at (22,22) — a function module the decoder skips, so the
     "damaged" symbol decoded perfectly and the negative control passed for the
     wrong reason. */
  const fn = reservedMap(3)
  let flipped = false
  for (let r = m.length - 1; r >= 0 && !flipped; r--) {
    for (let c = m.length - 1; c >= 0 && !flipped; c--) {
      if (fn[r][c]) continue
      m[r][c] = !m[r][c]
      flipped = true
    }
  }
  assert.ok(flipped, 'no data module was found to damage')
  let result = null
  try { result = decodeMatrix(m).text } catch { result = null }
  assert.notEqual(result, url, 'a damaged symbol decoded as though it were clean')
})

test('a flipped FORMAT module is reported rather than corrected', () => {
  const m = qrMatrix('https://checkitdown.com/install')
  m[0][8] = !m[0][8]
  assert.throws(() => decodeMatrix(m), /format information/)
})

/* ── The pixel path ───────────────────────────────────────────────────────── */

/** Render a matrix the way the SVG route does — quiet zone, integer scale —
 *  into a luma buffer, so the pixel locator can be tested without a browser. */
function rasterise(matrix, scale, quiet) {
  const n = matrix.length
  const side = (n + quiet * 2) * scale
  const data = new Uint8Array(side * side).fill(255)
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          data[((r + quiet) * scale + y) * side + (c + quiet) * scale + x] = 0
        }
      }
    }
  }
  return { data, width: side, height: side }
}

test('the pixel locator finds the grid and the URL comes back out of an image', () => {
  const url = 'https://checkitdown.com/install'
  const img = rasterise(qrMatrix(url), 6, 4)
  const { matrix, moduleSize } = matrixFromLuma(img)
  assert.equal(moduleSize, 6)
  assert.equal(matrix.length, 29)
  assert.equal(decodeMatrix(matrix).text, url)
})

test('the locator refuses an image with nothing in it', () => {
  assert.throws(() => matrixFromLuma({ data: new Uint8Array(400).fill(255), width: 20, height: 20 }),
    /no dark pixels/)
})
