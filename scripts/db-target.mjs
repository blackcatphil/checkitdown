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
 * For scripts that are GENUINELY BOTH — read anywhere, write only to production.
 * `scripts/differ.mjs` is the one: a dry run is a report you want against either
 * database, and `DIFFER_APPLY=1` is how the partner's documents reach the app.
 *
 * ⚠️ THIS EXISTS BECAUSE CLASSIFYING THE DIFFER AS `localTarget` WOULD HAVE
 * BROKEN THE 05:00 CRON. The sweep that split DATABASE_URL into local and
 * production read each script's INTENT from what it does on a laptop — and the
 * differ writes to production every morning from `sync.yml`, which no amount of
 * reading the file locally would have shown. A script's target is decided by
 * where it RUNS, not by where it is usually run by hand.
 *
 * Same one-sentence rule the tournament ingest has, and deliberately the same
 * words: reading takes either and says which; writing requires
 * PROD_DATABASE_URL by name and never falls back to DATABASE_URL, because that
 * name means local now.
 */
export function applyTarget(script, { writing, targetVar }) {
  /* ═══════════════════════════════════════════════════════════════════
     ⚠️ THE SAME SWITCH THE TOURNAMENT INGEST HAS, DELIBERATELY IDENTICAL.
     ═══════════════════════════════════════════════════════════════════
     ONE SENTENCE, AND IT IS THE WHOLE RULE:
     UNSET IS PRODUCTION · EXACTLY `local` IS LOCAL · ANYTHING ELSE REFUSES.

     That holds for a read exactly as for a write. The only difference is that
     writing to production requires PROD_DATABASE_URL by name.

     This is `rails.resolve_db` carried across without variation — same
     acceptance, same refusals, same reasons — because two switches that mean
     the same thing and behave differently are worse than either alone. If this
     ever needs to change, both change together.

     ⚠️ EMPTY REFUSES. `DIFFER_TARGET=$X` with X unset is the realistic way an
     empty value arrives, inside a command whose whole purpose was to name a
     target. `!== undefined` rather than a truthiness test is the difference,
     and production being the fallthrough is why it matters.

     ⚠️ AND NO NORMALISING. Not lowercase, not trimmed. A switch that guesses
     what you meant can guess wrong, and this one picks the database. */
  const target = targetVar ? process.env[targetVar] : undefined
  if (targetVar && target !== undefined && target !== 'local') {
    const shown = target === ''
      ? "'' (set but empty — an expansion that came out empty?)"
      : JSON.stringify(target)
    console.error(
      `\n[${script}] REFUSING TO RUN — ${targetVar}=${shown} is not a target this`
      + `\nunderstands.`
      + `\n  accepted:  local   (exactly — no capitals, no surrounding spaces)`
      + `\n  or UNSET:  PRODUCTION, and writing there needs PROD_DATABASE_URL`
      + `\nRefusing rather than guessing: production is the fallthrough here, so a`
      + `\nvalue this does not recognise would otherwise be used by whoever was`
      + `\ntrying to avoid it.\n`,
    )
    process.exit(2)
  }

  /* `local` answers the same whether reading or writing — a rehearsal that read
     a different database from the one the real run writes to is not a
     rehearsal. */
  if (target === 'local') {
    const url = process.env.DATABASE_URL
    if (!url) {
      console.error(`\n[${script}] REFUSING TO RUN — ${targetVar}=local needs DATABASE_URL set.\n`)
      process.exit(2)
    }
    if (!isLocal(url)) {
      console.error(
        `\n[${script}] REFUSING TO RUN — ${targetVar}=local, but DATABASE_URL is not a`
        + `\nlocal database.\n\n  refused: ${describe(url)}\n`
        + `\nThe one thing this switch promises is that it cannot reach production.\n`,
      )
      process.exit(2)
    }
    announce(script, writing ? 'local — WILL WRITE' : 'local (read-only)', url)
    return url
  }

  if (!writing) {
    /* ⚠️ PROD FIRST ON A READ, WHICH IS NOT WHAT `readTarget` DOES — and the
       difference is deliberate. `rails.resolve_db` resolves a dry run as
       `PROD_DATABASE_URL or DATABASE_URL`, so a rehearsal describes the
       database the real run would touch. A differ dry run is the rehearsal for
       a production write, so it follows the ingest rather than `readTarget`,
       whose scripts (map-measure, source-health) have no production role at all
       and default to local.
       Either way it ANNOUNCES, so the answer to "which database was that
       report about" is on screen rather than inferred. */
    const url = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL ?? LOCAL_DEFAULT
    announce(script, isLocal(url) ? 'local (read-only)' : 'PRODUCTION (read-only)', url)
    return url
  }
  const url = process.env.PROD_DATABASE_URL
  if (!url) {
    console.error(
      `\n[${script}] REFUSING TO RUN — this run WRITES, and PROD_DATABASE_URL is`
      + `\nnot set.\n`
      + `\nIt deliberately does NOT fall back to DATABASE_URL: that variable means`
      + `\n"local", and one name for two databases is what put migration 017 on`
      + `\nproduction. If this is a CI or cron run, bind the secret to`
      + `\nPROD_DATABASE_URL — the secret's NAME does not change, only the`
      + `\nenvironment variable it lands in.\n`,
    )
    process.exit(2)
  }
  announce(script, '⚠️  PRODUCTION — WILL WRITE', url)
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
