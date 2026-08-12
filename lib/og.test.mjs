import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { OG_LINES, OG_SIZE, fonts, markDataUri, ogColors } from './og.ts'

const ROOT = join(import.meta.dirname, '..')

/**
 * ⚠️ NO FIGURE MAY BE TYPED INTO THE SHARE CARD.
 *
 * "17 ROOMS" baked into an image is the number-copied-forward failure on the
 * one artefact nobody ever re-reads — and worse than the usual case, because a
 * share image is cached by the PLATFORM. Slack, X, Discord and iMessage each
 * fetch it once per URL and keep it; a link already posted keeps its picture
 * effectively forever. So the card would still say 17 the day the roster is 19,
 * on every share of the site ever made, and no deploy of ours could correct it.
 *
 * The copy therefore lives in `OG_LINES` as data, and this asserts it holds no
 * digits at all. A regex over the TSX could not do this: that file is full of
 * legitimate numbers — 1200, 630, font sizes, padding — and a check that had to
 * tell those apart from a room count would be the kind of clever test that goes
 * quietly wrong.
 */
test('no line on the share card contains a digit', () => {
  for (const [key, line] of Object.entries(OG_LINES)) {
    assert.ok(!/\d/.test(line), `OG_LINES.${key} contains a digit: ${JSON.stringify(line)}`)
  }
})

test('and no line mentions rooms in a way that implies a count', () => {
  for (const [key, line] of Object.entries(OG_LINES)) {
    assert.ok(!/\b(one|two|three|four|ten|eleven|twelve|seventeen|eighteen|nineteen|twenty)\b/i.test(line),
      `OG_LINES.${key} spells a number in words, which the digit check would miss: ${line}`)
  }
})

/**
 * THE COPY IS ONLY GATED IF THE CARD ACTUALLY READS IT. A line typed straight
 * into the JSX would render and escape both assertions above, so this checks
 * the image holds no bare prose of its own — every visible string comes through
 * `OG_LINES`.
 */
test('the card renders its copy from OG_LINES and holds no loose prose', () => {
  const tsx = readFileSync(join(ROOT, 'app', 'opengraph-image.tsx'), 'utf8')
  /* Strip comments first: this file explains itself at length, and that prose
     is not rendered. */
  const code = tsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  /* A JSX text node is anything between > and < that is not whitespace or an
     expression. There should be exactly one — the separator dot. */
  const textNodes = [...code.matchAll(/>([^<>{}]+)</g)]
    .map((m) => m[1].trim())
    .filter((t) => t !== '' && t !== '·')
  assert.deepEqual(textNodes, [],
    `the card renders text not declared in OG_LINES: ${JSON.stringify(textNodes)}`)
  for (const key of Object.keys(OG_LINES)) {
    assert.ok(code.includes(`OG_LINES.${key}`), `OG_LINES.${key} is declared but never rendered`)
  }
})

/* ── The materials ────────────────────────────────────────────────────── */

test('the card is the size every platform crops from', () => {
  assert.deepEqual(OG_SIZE, { width: 1200, height: 630 })
})

/**
 * ⚠️ THE REAL FACES, BUNDLED. A substituted lookalike would fake a bold weight
 * Instrument Serif does not have, and fetching them at render time would put a
 * network call inside a crawler that caches whatever it gets — including a card
 * drawn in a fallback font.
 */
test('both fonts load off disk, as the real files', () => {
  const f = fonts()
  assert.equal(f.length, 2)
  const byName = Object.fromEntries(f.map((x) => [x.name, x]))
  assert.ok(byName['Instrument Serif'], 'Instrument Serif is not bundled')
  assert.ok(byName['IBM Plex Mono'], 'IBM Plex Mono is not bundled')
  for (const [name, font] of Object.entries(byName)) {
    assert.ok(font.data.length > 20000, `${name} is suspiciously small — ${font.data.length} bytes`)
    /* A TrueType file starts 0x00010000, or 'OTTO' for CFF outlines. A 404 page
       saved to disk would sail past a length check. */
    const sig = font.data.subarray(0, 4)
    const ok = (sig[0] === 0 && sig[1] === 1 && sig[2] === 0 && sig[3] === 0)
      || sig.toString('ascii') === 'OTTO' || sig.toString('ascii') === 'true'
    assert.ok(ok, `${name} does not begin with a font signature: ${sig.toString('hex')}`)
  }
})

test('the mark is inlined from the generated icon, not redrawn', () => {
  const uri = markDataUri()
  assert.ok(uri.startsWith('data:image/png;base64,'))
  const bytes = Buffer.from(uri.split(',')[1], 'base64')
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'not a PNG')
  /* The same file the manifest and the tab are drawn from. If this ever stops
     being true the card gains a second copy of the mark, which is how two
     identities start. */
  const onDisk = readFileSync(join(ROOT, 'public', 'icon-512.png'))
  assert.ok(bytes.equals(onDisk), 'the card is not using public/icon-512.png')
})

/**
 * ⚠️ COLOURS COME FROM THE TOKENS. A share image outlives a palette change on
 * every link already posted, so a pasted hex here is the worst version of the
 * failure the icon generator was written to prevent.
 */
test('every colour resolves from the token file, and none is pasted', () => {
  const c = ogColors()
  for (const [k, v] of Object.entries(c)) {
    assert.match(v, /^#[0-9A-Fa-f]{6}$/, `${k} did not resolve to a hex: ${v}`)
  }
  const src = readFileSync(join(ROOT, 'lib', 'og.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
  const pasted = code.match(/#[0-9A-Fa-f]{6}\b/g) ?? []
  assert.deepEqual(pasted, [], `lib/og.ts has pasted hexes: ${pasted.join(', ')}`)
  const tsx = readFileSync(join(ROOT, 'app', 'opengraph-image.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.deepEqual(tsx.match(/#[0-9A-Fa-f]{6}\b/g) ?? [], [],
    'app/opengraph-image.tsx has pasted hexes')
})
