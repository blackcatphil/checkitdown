import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * TOKENS, READ ON THE SERVER — for the two places that need a colour as a
 * STRING rather than as a CSS variable.
 *
 * `lib/tokens.ts` reads computed styles, which only exist in a browser. The
 * manifest and the `theme_color` meta tag are emitted by the server and consumed
 * by the operating system: Android paints the task-switcher card and iOS paints
 * the status bar with them, and neither can resolve `var(--cid-ink-800)`.
 *
 * The tempting shortcut is to paste the hex into `manifest.ts`. That is how the
 * installed app keeps the old palette after a re-skin — a copy nobody thinks to
 * update, on a surface nobody looks at, which is the same shape as every other
 * number-copied-forward failure in this project. The blue/gold palette is
 * landing underneath this work, so it would have gone stale within the week.
 *
 * So the CSS file is parsed at build time and the token is resolved, including
 * one level of `var()` indirection (`--cid-pin: var(--cid-accent-500)`).
 *
 * THROWS RATHER THAN DEFAULTS. A missing token here would ship a manifest with
 * `undefined` in it, which installs and looks broken. Failing the build is the
 * cheaper outcome — the same reasoning as `readToken`'s throw on the client.
 */
const CSS_PATH = join(process.cwd(), 'app', 'styles', 'tokens', 'colors.css')

let cache: Map<string, string> | null = null

function parse(): Map<string, string> {
  if (cache) return cache
  const css = readFileSync(CSS_PATH, 'utf8')
  const out = new Map<string, string>()
  /* FIRST DEFINITION WINS. `colors.css` defines the dark palette in `:root` and
     re-states some tokens in a themed block further down; the OS chrome should
     match the app's default appearance, which is the first block. */
  for (const m of css.matchAll(/(--cid-[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1]
    if (!out.has(name)) out.set(name, m[2].trim())
  }
  cache = out
  return out
}

export function readServerToken(name: string): string {
  const tokens = parse()
  const raw = tokens.get(name)
  if (!raw) {
    throw new Error(`Token ${name} is not defined in app/styles/tokens/colors.css`)
  }
  /* One hop of indirection, e.g. `--cid-pin: var(--cid-accent-500)`. Deeper
     chains are not followed on purpose: a token that needs two hops to become a
     colour is a token the OS chrome should not be reaching for. */
  const ref = raw.match(/^var\(\s*(--cid-[\w-]+)\s*\)$/)
  if (ref) {
    const target = tokens.get(ref[1])
    if (!target) {
      throw new Error(`Token ${name} points at ${ref[1]}, which is not defined`)
    }
    return target
  }
  return raw
}
