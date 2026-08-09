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

const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** The sentinel. Nothing real will ever cite this, so deletion is exact. */
export const STAGED_SOURCE = 'https://example.test/probe-staged-description'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

const BODY =
  'A long room off the main floor, quiet on weeknights and busy the moment a '
  + 'series lands. The smallest game is {stakes_lowest} across {table_count} tables.'

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
