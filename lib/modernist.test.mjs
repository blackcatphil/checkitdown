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
 *
 * ═══ ⚠️ INJECT THE WAY A REGRESSION ARRIVES ═══
 *
 * EVERY red-proof in this file must APPEND a conflicting rule to the bottom of
 * the stylesheet. It must never edit the existing declaration.
 *
 * That is not a style preference, it is the difference between a guard and a
 * decoration. A regression does not arrive as a careful edit to the rule the
 * test happens to read — it arrives as a new line at the end of the file, and
 * in CSS the later rule wins. Proving a guard by editing the one occurrence it
 * inspects exercises exactly the path that already works.
 *
 * On 2026-08-12 appending `.ge-fig-absent { color: var(--color-accent-600) }`
 * left all twelve assertions green while the page rendered an accent-coloured
 * absence. TWO SEPARATE CAUSES, both fixed below:
 *
 *   1. `CONSOLE.match(...)` without /g read only the FIRST occurrence of a
 *      selector, and `assert.match` proves a rule EXISTS SOMEWHERE rather than
 *      that it is the one in effect. Both now resolve the LAST declaration, the
 *      way the cascade does.
 *   2. the accent scan matched `var(--color-accent)` exactly, so the entire
 *      ramp — `--color-accent-100..900` and every `--color-accent-2*` — was
 *      invisible to it. It now matches the prefix.
 */
const DS_ROOT = 'docs/design/growth-engine/_ds'
const dsDir = readdirSync(DS_ROOT).find((d) => d.startsWith('modernist-'))
const SOURCE = readFileSync(`${DS_ROOT}/${dsDir}/styles.css`, 'utf8')
const CONSOLE = readFileSync('app/admin/growth/growth.css', 'utf8')
/* The markup too — the leak this guards was a CLASS NAME, not a token, so a
   scan of the stylesheet alone could never have seen it. */
const PAGE = readFileSync('app/admin/growth/page.tsx', 'utf8')
/* ⚠️ AND THE FRAME. Until 2026-08-15 this guard read two files by name, which
   is why the SITE HEADER sitting directly above the console was invisible to
   it — the leak it was written for was one level down from the one nobody
   could see. `app/admin/layout.tsx` now wraps every admin route, so it is the
   single place a site token would spread from. */
const FRAME = readFileSync('app/admin/layout.tsx', 'utf8')
const FRAME_CSS = readFileSync('app/admin/admin.css', 'utf8')

/**
 * Every rule in a stylesheet, in source order: `{ selector, decls }`.
 *
 * ⚠️ ORDER IS THE WHOLE POINT. Everything below resolves the LAST matching
 * declaration, because that is the one the browser applies. A helper that
 * returned the first would reproduce the bug this file was rewritten for.
 */
function rules(css) {
  /* Comments stripped first — a commented-out declaration is not a rule, and a
     comment containing braces would split the next one in half. */
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    /* ⚠️ EVERYTHING AFTER THE LAST `;` IS THE SELECTOR. The capture greedily
       takes whatever precedes the brace, which includes any at-rule that came
       before it — the first parse read `@import url('…'); :root` as one
       selector and found zero tokens in either file. */
    selector: m[1].split(';').at(-1).trim().replace(/\s+/g, ' '),
    decls: Object.fromEntries([...m[2].matchAll(/([a-z-]+|--[a-z0-9-]+):\s*([^;]+);?/g)]
      .map((d) => [d[1], d[2].trim()])),
  }))
}

/** Every (selector, value) pair for a property, across the whole sheet. */
function declarations(css, prop) {
  return rules(css).flatMap((r) => (prop in r.decls
    ? [{ selector: r.selector, value: r.decls[prop] }] : []))
}

/**
 * The value the browser would apply for `selector` / `prop` — the LAST one.
 *
 * Selectors are compared exactly, which is right for this file: every rule here
 * is a single flat class and nothing depends on specificity beyond source
 * order. It returns undefined when nothing sets it.
 */
function effective(css, selector, prop) {
  const hits = rules(css).filter((r) => r.selector === selector && prop in r.decls)
  return hits.length ? hits.at(-1).decls[prop] : undefined
}

/** Custom properties, with LATER blocks winning — a second `.ge {` overrides. */
function tokens(css, selector) {
  const out = {}
  for (const r of rules(css)) {
    if (r.selector !== selector) continue
    for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) out[k] = v
  }
  return out
}

const src = tokens(SOURCE, ':root')
const con = tokens(CONSOLE, '.ge')

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

/* ─── THE SCOPING RULE: TWO SYSTEMS, NO MIXING ──────────────────────────── */

test('nothing in the growth console reaches for the site design system', () => {
  /**
   * ⚠️ THE LEAK THIS EXISTS FOR, FOUND 2026-08-15 BY DIFFING THE DESIGN.
   *
   * `page.tsx` rendered three labels with `className="cid-label"`, which
   * resolves to `--cid-gold-300` — the SITE's gold — inside a Modernist page,
   * while `.ge-kicker` sat unused two files away. The signed-out branch also
   * carried `.cid-page` and five inline `--cid-*` tokens, so a stranger met a
   * half-skinned screen.
   *
   * Nothing caught it because every existing guard reads `growth.css`, and
   * `growth.css` was clean: the leak was a class name in the MARKUP borrowing a
   * rule from `globals.css`. That is precisely the failure CONSUMING.md's
   * scoping rule names — "two token systems in one repo is how a retired
   * palette survives on the icons" — and prose does not enforce itself.
   *
   * Comments are stripped first: this file's own history is written in them and
   * they mention `--cid-*` by name, so scanning raw text would fail on the
   * explanation of the bug rather than the bug.
   */
  const strip = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  const offenders = []
  for (const [name, text] of [
    ['growth.css', CONSOLE], ['page.tsx', PAGE],
    ['admin/layout.tsx', FRAME], ['admin/admin.css', FRAME_CSS],
  ]) {
    for (const m of strip(text).matchAll(/--cid-[a-z0-9-]+|\bcid-[a-z0-9-]+\b/g)) {
      const line = strip(text).slice(0, m.index).split('\n').length
      offenders.push(`${name}:${line} ${m[0]}`)
    }
  }
  assert.deepEqual(offenders, [],
    'the growth console is scoped to Modernist and may not use a `cid-` class '
    + 'or token — the site system is a different palette, and one gold label '
    + 'inside this page is how a retired palette survives:\n  '
    + offenders.join('\n  '))
})

/* ─── THE CID LAW THAT OUTRANKS THE SYSTEM ─────────────────────────────── */

test('no data state is carried by colour — the accent is reserved for faults', () => {
  /* The three absence states must differ by TEXT and WEIGHT, never by hue, so
     they survive greyscale. The accent may mark a fault, which is the page
     failing to answer rather than a state of the data. */
  /* ⚠️ THE WHOLE RAMP, NOT JUST THE BASE TOKEN. This matched
     `var(--color-accent)` with its closing paren, so every step of
     `--color-accent-100..900` and every `--color-accent-2*` was invisible —
     which is how an appended `color: var(--color-accent-600)` passed. Matching
     the PREFIX covers the family. */
  /* ⚠️ THE FRAME TOO. This read `growth.css` alone, so every accent rule in
     `admin.css` — a whole stylesheet added on 2026-08-15 — was unchecked by the
     law it is most exposed to. The leak guard was extended to the frame in the
     same pass and this was not, which is the narrower version of the same
     mistake: a guard that names its inputs has to be told when a new one
     arrives. */
  const accentRules = rules(`${CONSOLE}\n${FRAME_CSS}`)
    .filter((r) => Object.values(r.decls).some((v) => v.includes('var(--color-accent')))
    .map((r) => ({ sel: r.selector }))
  assert.ok(accentRules.length > 0, 'no accent rule found — this assertion would be vacuous')
  for (const { sel } of accentRules) {
    /* CONTROLS may carry the accent — a button, a link, a tab, a focus ring is
       an affordance, not a claim about data. What may not is anything standing
       for verified / unverified / absent, or for one of the three absence
       states. The guard fired on `.btn-primary` when the button rules landed,
       which is it working: widening it is a decision, and this is the reason. */
    /* ⚠️ WIDENED 2026-08-15 FOR `ge-eq-op`, AND THIS IS THE WHOLE JUSTIFICATION.
       The `×` and `=` in the equation grid are the equation's SYNTAX — fixed
       glyphs that never change with the numbers, structurally a rule or a
       bullet rather than a value. Nothing about them says whether a figure is
       verified, absent or moving, which is the property §6 actually protects.
       Widening this pattern is a decision every time; the guard firing on
       `.btn-primary` and now on `.ge-eq-op` is it doing its job, and each
       addition is admitted BY NAME so a wildcard never creeps in.

       `ge-seg-on` is the same category as `ge-tab`: WHICH of four areas you are
       looking at is an affordance you chose, not a property of any room. The
       selected week's bar in the design is licensed on exactly this ground.

       `ge-sum-op` is `ge-eq-op` in words rather than glyphs: "new", "+",
       "returned", "=" are the sum sentence's syntax and never change with the
       figures they join.

       `ge-brand-kicker` names the PRODUCT AREA — "Growth engine" beside the
       mark. It is branding, fixed for every reader on every screen, and says
       nothing about any figure. */
    assert.match(sel, /fault|focus-visible|selection|\.ge a\b|ge-tab|btn|ge-eq-op|ge-seg-on|ge-sum-op|ge-brand-kicker/,
      `"${sel}" uses the accent. Only faults and CONTROLS (buttons, links, tabs, `
      + 'focus, selection) may — a data state carried by hue is forbidden by §6 '
      + 'regardless of what the design system does.')
  }
})

test('the absence states are distinguished by form, not hue', () => {
  /* ⚠️ EVERY DECLARATION, NOT THE FIRST. This read
     `CONSOLE.match(/\.ge-fig-absent\s*\{([^}]*)\}/)` — no /g — so appending a
     second `.ge-fig-absent { color: … }` at the bottom of the file left it
     green while the page rendered an accent-coloured absence. */
  const colours = declarations(CONSOLE, 'color')
    .filter((d) => d.selector.includes('ge-fig-absent'))
  assert.deepEqual(colours, [],
    'the absent state sets a colour somewhere — it must differ from a number by '
    + 'size and weight so it survives greyscale. Found: '
    + colours.map((c) => `${c.selector} { color: ${c.value} }`).join(', '))

  assert.ok(
    effective(CONSOLE, '.ge-fig-absent', 'font-size')
    || effective(CONSOLE, '.ge-fig-absent', 'font-weight'),
    'the absent state must differ from a number by form')
})

/* ─── DELIBERATE DIVERGENCES ─────────────────────────────────────────────
 *
 * ⚠️ AN ALLOWLIST THAT ONLY PERMITS IS A BLINDFOLD. These are the rules where
 * the console deliberately departs from the system. Each has a reason, and the
 * assertion is TWO-SIDED:
 *
 *   · the console must still hold `ours`   — nobody quietly reverted it
 *   · the system must still hold `theirs`  — the divergence is still a
 *                                            divergence
 *
 * The second half is the one that matters. If the system is regenerated and
 * fixed, `theirs` stops matching and this FAILS — telling us the divergence is
 * over and the override should be deleted, rather than leaving a permanent
 * override nobody revisits against a system that has moved.
 */
const DIVERGENCES = [
  {
    what: '.btn justify-content',
    /* ⚠️ SELECTOR + PROPERTY + EXPECTED VALUE, resolved through the cascade —
       not a regex over the file. `assert.match(CONSOLE, /…flex-start/)` proves
       the rule EXISTS SOMEWHERE, so an appended `.ge .btn { justify-content:
       center }` left it green while the button centred. */
    selector: '.ge .btn', prop: 'justify-content', ours: 'flex-start',
    theirSelector: '.btn', theirs: 'center',
    why: 'the SYSTEM contradicts itself — readme.md:3, :14 ("never centered") '
      + 'and :51 all say flush left; styles.css:115 centers. readme.md:10 says '
      + 'the guidance is the direction and the CSS is what drifts.',
  },
]

test('the divergence allowlist is not empty — an empty one would prove nothing', () => {
  assert.ok(DIVERGENCES.length > 0)
})

test('each deliberate divergence is still ours', () => {
  for (const d of DIVERGENCES) {
    assert.equal(effective(CONSOLE, d.selector, d.prop), d.ours,
      `${d.what}: the console's EFFECTIVE value is not "${d.ours}" — a later rule `
      + `overrides it, or it was removed. Reason it exists — ${d.why}`)
  }
})

test('each deliberate divergence is still a divergence — the system has not been fixed', () => {
  for (const d of DIVERGENCES) {
    assert.equal(effective(SOURCE, d.theirSelector, d.prop), d.theirs,
      `${d.what}: the DESIGN SYSTEM no longer disagrees. The divergence is over — `
      + 'delete the override in app/admin/growth/growth.css and the entry here, '
      + 'rather than carrying a permanent fork against a system that has moved.')
  }
})

test('.dialog-actions is NOT diverged — it is left exactly as the system has it', () => {
  /* Flush-left is about a LABEL INSIDE A BUTTON. `.dialog-actions` aligns a
     GROUP of buttons in a footer, which the rule does not reach. Pinned so
     nobody "consistency-fixes" it later. */
  assert.equal(effective(SOURCE, '.dialog-actions', 'justify-content'), 'flex-end')
  assert.equal(effective(CONSOLE, '.ge .dialog-actions', 'justify-content'), 'flex-end')
})
