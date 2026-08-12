/**
 * STAGE A ROOM DESCRIPTION FOR A PROBE, THEN TAKE IT AWAY AGAIN.
 *
 * The description section is EMPTY-SAFE: no row, no section. That is the
 * correct shipped state — content arrives through the queue, not through a
 * commit or a seed — and it means a probe that simply loads a room page sees
 * nothing and passes without measuring anything. That is the vacuous pass this
 * repo keeps catching, so the probes that need prose stage their own.
 *
 * The body carries TOKENS, never figures, for the same reason the schema
 * refuses typed currency: a fixture that hardcodes "$1/2" is the very habit the
 * gate exists to prevent, and it would go stale in a fixture exactly as fast as
 * it would in production.
 *
 * `unstage` deletes by the sentinel source_url rather than by room, so it can
 * never remove a real description that happened to be there — and it is called
 * from a `finally`, because a probe that crashes mid-run must not leave prose
 * behind on a page.
 */
import { execFileSync } from 'node:child_process'
import { resolvePsql } from './psql-path.mjs'
import { localTarget } from './db-target.mjs'

/* $PSQL, else `psql` from PATH, else the Homebrew path. See psql-path.mjs:
   an absolute machine-specific path as a DEFAULT is what broke CI. */
const PSQL = resolvePsql()
const DB = localTarget('stage-description')

/** The sentinel. Nothing real will ever cite this, so deletion is exact. */
export const STAGED_SOURCE = 'https://example.test/probe-staged-description'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

/* MULTI-PARAGRAPH ON PURPOSE. The real partner reviews are 3–8 paragraphs and
   the renderer splits on blank lines; a single-paragraph fixture cannot tell a
   working splitter from the wall-of-text bug it replaced, and it duly reported
   "1 paragraphs" against a page rendering eight. A fixture that cannot exhibit
   the failure is not a fixture for it. */
const BODY =
  'A long room off the main floor, quiet on weeknights and busy the moment a '
  + 'series lands. The smallest game is {stakes_lowest} across {table_count} tables.'
  + '\n\n'
  + 'The second paragraph exists so the renderer has a blank line to split on. '
  + 'Its content does not matter; its separation does.'

export function stageDescription(slug) {
  sql(`
    insert into room_descriptions (room_id, body, author_kind, written_at, source_url, fetched_at)
    select id, '${BODY.replace(/'/g, "''")}', 'checkitdown', '2026-08-09',
           '${STAGED_SOURCE}', now()
      from rooms where slug = '${slug.replace(/'/g, "''")}'
    on conflict (room_id) do nothing`)
  /* PROVE IT LANDED. `on conflict do nothing` is the right behaviour — a real
     description must win over a fixture — but it also means a silent no-op, and
     a probe that then measures an absent section would report PASS on nothing. */
  const n = Number(sql(`select count(*) from room_descriptions where source_url = '${STAGED_SOURCE}'`))
  return n > 0
}

export function unstageDescription() {
  sql(`delete from room_descriptions where source_url = '${STAGED_SOURCE}'`)
}
