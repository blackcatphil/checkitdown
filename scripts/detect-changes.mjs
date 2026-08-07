#!/usr/bin/env node
/**
 * CHANGE DETECTOR — proposes, never writes.
 *
 * Scrapers are not writers in this product. This re-fetches the sources that
 * are actually fetchable, compares what they say against what we hold, and
 * raises a `pending_changes` row for each genuine disagreement. It has no
 * UPDATE on any fact table and could not apply a change if it wanted to: the
 * only path from a proposal to a fact is a human in /admin/review.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/detect-changes.mjs
 *   ... --dry-run     # fetch, compare and report; write nothing
 *
 * THE KEY IS READ FROM THE ENVIRONMENT AT RUN TIME AND IS NEVER COMMITTED.
 * It is deliberately absent from .env.local, from the app and from Vercel —
 * the site runs on the anon key, and admin privilege is a row in `admins`
 * rather than a key. This script is the only thing that holds service_role, it
 * runs from a laptop or a scheduled job, and if this file leaked it would leak
 * no credential.
 *
 * ZERO DISAGREEMENTS IS A RESULT, NOT A FAILURE. It does not invent a row to
 * prove the queue works. An empty queue with a recorded run means "we checked
 * and nothing moved", which is a different statement from "nobody has looked" —
 * and the admin page tells those two apart, the same way the amenities block
 * separates a confirmed absence from an unchecked one.
 */
import { createHash } from 'node:crypto'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY = process.argv.includes('--dry-run')

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set.')
  console.error('This script is the only holder of that key. Export it for the run; do not put it in .env.local.')
  process.exit(1)
}

/* Overpass returned 406 to a request with no User-Agent and the failure was
   read as "the API is unreachable" for a week. Every fetch here identifies
   itself. */
const UA = 'Mozilla/5.0 (compatible; CheckItDownBot/1.0; +https://checkitdown.com/about)'

const rest = async (path, init = {}) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.slice(0, 200)}`)
  return body ? JSON.parse(body) : null
}

/**
 * WHICH SOURCE BELONGS TO WHICH ROOM, written out by hand because
 * `sources.room_id` is NULL for every row in the seed — the link does not exist
 * in the data yet, and guessing it from a URL substring is how "Venetian"
 * became the Sphere. Each entry names the room, the source URL as stored, and
 * the extractor that can read it.
 *
 * Only four sources in the survey are fetchable at all, and two of those turn
 * out not to be usable — see the notes. Recording that is the point: a source
 * that 404s is a finding, not a gap to paper over.
 */
const TARGETS = [
  {
    slug: 'wynn-encore',
    url: 'https://vegasadvantage.com/open-las-vegas-poker-rooms/wynn/',
    extract: extractRake,
  },
  {
    slug: 'venetian',
    url: 'https://vegasadvantage.com/open-las-vegas-poker-rooms/venetian/',
    extract: extractRake,
  },
  {
    slug: 'orleans',
    url: 'https://orleans.boydgaming.com/play/poker-room',
    extract: extractRake,
    note: 'serves a ~212-byte JS shell; the content is rendered client-side',
  },
  {
    slug: 'westgate',
    /* Copied from `sources`, not retyped. The first version of this line said
       `westgate-las-vegas-resort-and-casino`; the stored URL has no "and". It
       404'd, and the run reported "the URL we hold 404s" — a finding about a
       URL we do not hold, produced by my typo. Any target not present in
       `sources` is now a hard failure below rather than a silent skip. */
    url: 'https://www.westgateresorts.com/hotels/nevada/las-vegas/westgate-las-vegas-resort-casino/casino/poker/',
    extract: extractRake,
  },
]

/**
 * Pulls a rake cap and jackpot drop out of prose like
 *   "rakes 10% up to $5. There is no jackpot drop."
 *   "rakes up to $5. There is a jackpot drop of up to $2."
 * Written against the bytes these pages actually serve, not against an
 * imagined format. Returns null when it cannot find the sentence, which is
 * different from finding a different number.
 */
export function extractRake(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ')
  const rake = text.match(/rakes?\s+(?:(\d+)%\s+)?up to \$(\d+(?:\.\d+)?)/i)
  if (!rake) return null
  const drop = text.match(/no jackpot drop/i)
    ? 0
    : Number(text.match(/jackpot drop of up to \$(\d+(?:\.\d+)?)/i)?.[1] ?? NaN)
  return {
    rake_percent: rake[1] != null ? Number(rake[1]) : null,
    rake_cap: Number(rake[2]),
    jackpot_drop: Number.isNaN(drop) ? null : drop,
  }
}

/** A 200 is transport, not content. A page that parses to nothing is a failure. */
function classify(status, bytes, parsed) {
  if (status !== 200) return { ok: false, why: `HTTP ${status}` }
  if (bytes < 2000) return { ok: false, why: `${bytes} bytes — a shell, not a page` }
  if (!parsed) return { ok: false, why: 'fetched and parsed, but the rake sentence is not in it' }
  return { ok: true, why: null }
}

const rooms = await rest('rooms?select=id,slug,name')
const bySlug = new Map(rooms.map((r) => [r.slug, r]))
const sources = await rest('sources?select=id,url,data_type&data_type=eq.cash')
const sourceByUrl = new Map(sources.map((s) => [s.url, s]))

let proposed = 0
const report = []

for (const t of TARGETS) {
  const room = bySlug.get(t.slug)
  const source = sourceByUrl.get(t.url)
  /* A target that matches no stored source silently skipped its own bookkeeping
     in the first version — the fetch happened, the outcome was reported, and
     nothing was written to `sources`, so a failing source went on looking
     unchecked. If the mapping is wrong, say so instead of half-working. */
  if (!room) throw new Error(`no room with slug ${t.slug}`)
  if (!source) {
    throw new Error(`no cash source in the database with url ${t.url} — the mapping in TARGETS is stale`)
  }
  let status = 0
  let body = ''
  try {
    const res = await fetch(t.url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    status = res.status
    body = await res.text()
  } catch (e) {
    report.push({ slug: t.slug, ok: false, why: `fetch threw: ${String(e).slice(0, 60)}` })
    continue
  }

  const parsed = t.extract(body)
  const verdict = classify(status, body.length, parsed)
  const hash = createHash('sha256').update(body).digest('hex')

  /* The fetch is recorded whether or not it worked. `last_ok_at` is what tells
     the admin page "the detector has run"; leaving it unset on failure is what
     keeps a broken source from looking like a checked one. */
  if (source && !DRY) {
    await rest(`sources?id=eq.${source.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        last_fetched_at: new Date().toISOString(),
        content_hash: hash,
        status: verdict.ok ? 'ok' : 'failing',
        last_error: verdict.why,
        ...(verdict.ok ? { last_ok_at: new Date().toISOString() } : {}),
      }),
    })
  }

  if (!verdict.ok) {
    report.push({ slug: t.slug, ok: false, why: verdict.why, note: t.note })
    continue
  }

  /* Compare against every game whose cap we hold. A disagreement is a
     DIFFERENT number, never a missing one — "the page no longer says" is not
     evidence that the figure changed. */
  const games = await rest(`cash_games?select=id,room_id,stakes_label,rake_cap,rake_percent,jackpot_drop&room_id=eq.${room.id}&rake_cap=not.is.null`)
  const diffs = []
  for (const g of games) {
    for (const [field, found] of Object.entries(parsed)) {
      if (found == null) continue
      const held = g[field]
      if (held == null) continue
      if (Number(held) !== Number(found)) diffs.push({ game: g, field, held: Number(held), found })
    }
  }

  for (const d of diffs) {
    proposed++
    if (DRY) continue
    await rest('pending_changes', {
      method: 'POST',
      body: JSON.stringify({
        target_table: 'cash_games',
        target_id: d.game.id,
        /* The room the TARGET belongs to, taken from the target row itself.
           Naming a different room here is the Westgate provenance bug in the
           write path, and approve_change refuses it — correctly, but the
           detector should not be producing it in the first place. */
        room_id: d.game.room_id,
        field: d.field,
        old_value: d.held,
        new_value: d.found,
        source_id: source?.id ?? null,
        source_url: t.url,
        agent: 'detect-changes',
        confidence: 0.6,
        note: `${room.name} ${d.game.stakes_label}: page says ${d.found}, we hold ${d.held}`,
      }),
    })
  }

  report.push({ slug: t.slug, ok: true, parsed, games: games.length, diffs: diffs.length })
}

console.log(`\ndetect-changes${DRY ? ' (dry run)' : ''} — ${TARGETS.length} sources\n`)
for (const r of report) {
  if (!r.ok) {
    console.log(`  UNUSABLE  ${r.slug.padEnd(12)} ${r.why}${r.note ? ` — ${r.note}` : ''}`)
  } else {
    console.log(`  READ      ${r.slug.padEnd(12)} cap $${r.parsed.rake_cap}`
      + `${r.parsed.rake_percent != null ? ` at ${r.parsed.rake_percent}%` : ''}`
      + `, drop $${r.parsed.jackpot_drop} · ${r.games} games held · ${r.diffs} disagreement(s)`)
  }
}
const usable = report.filter((r) => r.ok).length
console.log(`\n  ${usable} of ${TARGETS.length} sources usable · ${proposed} proposal(s) raised`)
if (proposed === 0) {
  /* Said out loud, because "it printed nothing" and "it found nothing" look the
     same in a terminal and mean opposite things. */
  console.log('  Nothing disagreed with what we hold. That is a result: the queue stays empty on purpose.')
}
