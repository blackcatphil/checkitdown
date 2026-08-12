/**
 * WHICH DATABASE, SAID OUT LOUD, BEFORE THE FIRST STATEMENT.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * On 2026-08-12 migration 017 was applied to PRODUCTION by a run that believed
 * it was working locally, and a gate then left three throwaway tables in the
 * production `analytics` schema — one of them anon-readable. The cause was not a
 * missing guard. It was a NAME: `.env.local` held the production connection
 * string under `DATABASE_URL`, which is the variable every psql-driving script
 * in this repo reaches for by default. The most dangerous database in the
 * project was sitting under the most reflexive name, and eleven scripts said
 * `process.env.DATABASE_URL ?? 'postgresql://…54322…'` — a line that reads as
 * "local by default" and means "production, if the shell happens to have it".
 *
 * `DATABASE_URL` now points at local and production lives under
 * `PROD_DATABASE_URL`. This module is the other half: a script no longer says
 * which database it *falls back to*, it says which database it *is for*, and it
 * prints the host it resolved before it does anything.
 *
 * ⚠️ THE PRINTING IS NOT DECORATION. Every incident of this class shares one
 * property: the operator believed something about the target that was false, and
 * nothing on screen contradicted them. A host echoed before the first statement
 * is the cheapest possible contradiction.
 */
const LOCAL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const PROD_REF = 'rhsayldolpyfpzpknvrx'

const isLocal = (url) => /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)

/** Host and database only — never the password, never the user's token. */
export function describe(url) {
  const m = url.match(/@([^/?]+)\/([^?]+)/)
  return m ? `${m[1]}/${m[2]}` : '(unparseable connection string)'
}

function announce(script, kind, url) {
  console.log(`  [${script}] ${kind} → ${describe(url)}`)
}

/**
 * For scripts that must NEVER touch production: local fixtures, destructive
 * probes, anything that truncates or stages test rows.
 *
 * Refuses a non-local URL outright rather than falling back — a fallback is
 * exactly the behaviour that made the incident possible.
 */
export function localTarget(script) {
  const url = process.env.DATABASE_URL ?? LOCAL_DEFAULT
  if (!isLocal(url)) {
    console.error(
      `\n[${script}] REFUSING TO RUN — this script writes or truncates, and`
      + `\nDATABASE_URL does not point at a local database:\n\n  ${describe(url)}\n`
      + `\nProduction lives in PROD_DATABASE_URL and is not reachable from here.`
      + `\nUnset DATABASE_URL to use ${describe(LOCAL_DEFAULT)}.\n`,
    )
    process.exit(2)
  }
  announce(script, 'LOCAL', url)
  return url
}

/**
 * For scripts that are ABOUT production — the census, the prod gate.
 *
 * ⚠️ NO FALLBACK TO `DATABASE_URL`. Reading it as a second choice would rebuild
 * the exact ambiguity this module was written to remove: the same variable
 * meaning "local" in one script and "production" in another. If a script wants
 * production it must be handed `PROD_DATABASE_URL`, by name.
 *
 * `writes: true` makes the announcement say so, because "connected to
 * production" and "about to write to production" deserve different attention.
 */
export function prodTarget(script, { writes = false } = {}) {
  const url = process.env.PROD_DATABASE_URL
  if (!url) {
    console.error(
      `\n[${script}] REFUSING TO RUN — this script targets PRODUCTION and`
      + `\nPROD_DATABASE_URL is not set.\n`
      + `\nIt deliberately does NOT fall back to DATABASE_URL: that variable now`
      + `\nmeans "local", and one name meaning two databases is what put migration`
      + `\n017 on production by accident.\n`,
    )
    process.exit(2)
  }
  if (!url.includes(PROD_REF)) {
    console.error(
      `\n[${script}] REFUSING TO RUN — PROD_DATABASE_URL is not the production`
      + `\nproject. A green run against the wrong cluster is a true statement`
      + `\nabout the wrong database, and it would be believed.\n`
      + `\n  expected project ref: ${PROD_REF}\n  got: ${describe(url)}\n`,
    )
    process.exit(2)
  }
  announce(script, writes ? '⚠️  PRODUCTION — WILL WRITE' : 'PRODUCTION (read-only)', url)
  return url
}

/**
 * For read-only scripts that are happy either way — measurements and health
 * checks that answer a question about whichever database they are pointed at.
 * Still announces, because "which database did that number come from" is the
 * whole value of the number.
 */
export function readTarget(script) {
  const url = process.env.DATABASE_URL ?? LOCAL_DEFAULT
  announce(script, isLocal(url) ? 'LOCAL (read-only)' : 'REMOTE (read-only)', url)
  return url
}
