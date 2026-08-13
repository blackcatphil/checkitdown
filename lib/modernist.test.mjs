import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * ⚠️ THE CONSOLE'S STYLESHEET IS A COPY, AND A COPY NOBODY CHECKS IS THE BUG.
 *
 * `app/admin/growth/growth.css` takes its tokens from the Modernist design
 * system under `docs/design/growth-engine/_ds/`. It copies rather than imports,
 * because importing would tie a shipped admin route to a path under `docs/` —
 * and `docs/` is exactly the directory people reorganise.
 *
 * The cost of copying is drift, so drift is what this asserts. Same shape as
 * `check:worker`, which gates the generated MapLibre worker against the
 * installed package for the same reason.
 *
 * It is offline, reads two files, and runs under `test:unit`.
 */
const DS_ROOT = 'docs/design/growth-engine/_ds'
const dsDir = readdirSync(DS_ROOT).find((d) => d.startsWith('modernist-'))
const SOURCE = readFileSync(`${DS_ROOT}/${dsDir}/styles.css`, 'utf8')
const CONSOLE = readFileSync('app/admin/growth/growth.css', 'utf8')

/** `--name: value;` pairs from a stylesheet's first :root / .ge block. */
function tokens(css, selector) {
  const start = css.indexOf(selector)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)]
    .map((m) => [m[1], m[2].trim()]))
}

const src = tokens(SOURCE, ':root')
const con = tokens(CONSOLE, '.ge {')

/* ⚠️ THE CONTROL. Every assertion below is "each copied token matches". If the
   parser found nothing, all of them pass and the gate is decoration. */
test('both stylesheets parse into tokens — without this the gate is vacuous', () => {
  assert.ok(Object.keys(src).length > 30, `parsed ${Object.keys(src).length} source tokens`)
  assert.ok(Object.keys(con).length > 20, `parsed ${Object.keys(con).length} console tokens`)
})

test('every token the console copies still matches the design system', () => {
  const drifted = Object.entries(con)
    .filter(([k]) => k in src)
    .filter(([k, v]) => src[k] !== v)
    .map(([k, v]) => `${k}: console has ${v}, the system says ${src[k]}`)
  assert.deepEqual(drifted, [],
    'the console stylesheet has drifted from the design system. Re-copy the '
    + 'changed tokens; the system is the source of truth.')
})

test('the console copies no token the system does not define', () => {
  const invented = Object.keys(con).filter((k) => !(k in src))
  assert.deepEqual(invented, [],
    'these look like tokens but are not in the design system — a value '
    + 're-derived from prose rather than taken from the file')
})

/* ─── THE NON-NEGOTIABLES, ASSERTED RATHER THAN TRUSTED ─────────────────── */

test('zero radius everywhere — the system says 0px and the console must not soften it', () => {
  for (const r of ['--radius-sm', '--radius-md', '--radius-lg']) {
    assert.equal(src[r], '0px', `the system's ${r} is no longer 0px`)
    assert.equal(con[r], '0px', `the console's ${r} is not 0px`)
  }
  /* ⚠️ THE VALUE IS READ, NOT LOOKED-AHEAD. The first version was
     `/border-radius:\s*(?!var\(--radius|0)/` and failed against a file whose
     only radius WAS `var(--radius-md)`: `\s*` matches zero characters, so the
     engine backtracked to before the space and the lookahead saw " var(...".
     A guard that fails on correct input gets deleted, not fixed. */
  const radii = [...CONSOLE.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim())
  for (const r of radii) {
    assert.match(r, /^var\(--radius-(sm|md|lg)\)$|^0(px)?$/,
      `border-radius: ${r} — the system's radii are all 0 and must come from a token`)
  }
})

test('no animation — the system declares none and the console adds none', () => {
  for (const [name, css] of [['the design system', SOURCE], ['the console', CONSOLE]]) {
    assert.doesNotMatch(css, /transition:/, `${name} declares a transition`)
    assert.doesNotMatch(css, /@keyframes/, `${name} declares a keyframe animation`)
  }
})

test('shadows appear only on cards and the dialog', () => {
  /* Every box-shadow in the console must be on a card-like surface. The system
     restricts elevation to cards, the elev- helpers and the dialog; the console
     has no dialog yet, so figures are the only place it may appear. */
  const withShadow = [...CONSOLE.matchAll(/([^{}]+)\{[^}]*box-shadow:[^}]*\}/g)]
    .map((m) => m[1].trim().split('\n').pop().trim())
  for (const sel of withShadow) {
    assert.match(sel, /ge-fig\b|dialog/,
      `box-shadow on "${sel}" — the system puts elevation on cards and the dialog only`)
  }
})

/* ─── THE CID LAW THAT OUTRANKS THE SYSTEM ─────────────────────────────── */

test('no data state is carried by colour — the accent is reserved for faults', () => {
  /* The three absence states must differ by TEXT and WEIGHT, never by hue, so
     they survive greyscale. The accent may mark a fault, which is the page
     failing to answer rather than a state of the data. */
  const accentRules = [...CONSOLE.matchAll(/([^{}]+)\{([^}]*var\(--color-accent\)[^}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim().split('\n').pop().trim(), body: m[2] }))
  for (const { sel } of accentRules) {
    assert.match(sel, /fault|focus-visible|selection|\.ge a\b|ge-tab/,
      `"${sel}" uses the accent. Only faults, focus, selection, links and nav may — `
      + 'a data state carried by hue is forbidden by §6 regardless of what the '
      + 'design system does.')
  }
})

test('the absence states are distinguished by form, not hue', () => {
  const absent = CONSOLE.match(/\.ge-fig-absent\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.doesNotMatch(absent, /color:/,
    'the absent state sets a colour — it must differ from a number by size and '
    + 'weight so it survives greyscale')
  assert.match(absent, /font-size|font-weight/,
    'the absent state must differ from a number by form')
})
