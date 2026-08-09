/**
 * WHERE `psql` IS — resolved, not assumed.
 *
 * ═══ THE BUG THIS FIXES ═══
 *
 * Every script here defaulted to '/opt/homebrew/opt/postgresql@17/bin/psql'.
 * That path exists on one Mac and nowhere else — not on CI's Linux runner, not
 * on a Linux workstation, not on an Intel Mac (/usr/local), not under a
 * different Postgres major. As a FALLBACK it is a convenience; as a DEFAULT it
 * is a machine-specific absolute path baked into the repo.
 *
 * It went unnoticed because the one step that exercised it — test:mixed — is
 * handed `PSQL: psql` explicitly in ci.yml, so the default was never taken on
 * CI. The day test:mobile started staging a fixture through the same helper,
 * the default was taken for the first time and the runner died with a bare
 * spawnSync ENOENT after a screen of green PASSes.
 *
 * ═══ THE ORDER ═══
 *
 *   1. $PSQL — an explicit choice always wins, and ci.yml states it per step.
 *   2. `psql` from PATH — the portable answer, and the one CI actually has.
 *   3. The Homebrew path — kept so a Mac with Postgres installed but not
 *      linked keeps working, which is why it was there in the first place.
 *
 * Step 2 RUNS the binary rather than testing for a file, because "on PATH" is
 * the only property that matters to execFileSync and a file that exists but
 * cannot execute would fail identically to one that is absent.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Kept as a fallback for a Mac with Postgres installed but not linked. */
export const HOMEBREW_PSQL = '/opt/homebrew/opt/postgresql@17/bin/psql'

let cached = null

export function resolvePsql() {
  if (cached) return cached

  if (process.env.PSQL) {
    cached = process.env.PSQL
    return cached
  }

  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' })
    cached = 'psql'
    return cached
  } catch {
    /* Not on PATH, or not executable. Fall through — this is the expected
       case on a Mac where Postgres is installed but never linked. */
  }

  if (existsSync(HOMEBREW_PSQL)) {
    cached = HOMEBREW_PSQL
    return cached
  }

  /* NAME THE BINARY AND THE ENV VAR. The failure this replaces was
     `Error: spawnSync /opt/homebrew/.../psql ENOENT` with a stack — which
     tells a reader on a Linux runner nothing about what to install or what to
     set, and reads like a broken script rather than a missing dependency. */
  throw new Error(
    'psql was not found.\n'
    + '   Tried: $PSQL (unset), `psql` on PATH, and ' + HOMEBREW_PSQL + '.\n'
    + '   Install the PostgreSQL client so `psql` is on PATH, or set PSQL to\n'
    + '   its full path:  PSQL=/path/to/psql npm run <script>',
  )
}
