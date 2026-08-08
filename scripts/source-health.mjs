#!/usr/bin/env node
/**
 * SOURCE HEALTH — every row in `sources`, fetched and classified.
 *
 * The detector watches four sources. There are forty-four, and the other forty
 * have never been checked as a set. We already know decay is real and silent:
 * the Orleans page now serves a ~900-byte JS shell where thirteen cash games
 * are cited to it, Westgate dropped the rake sentence its figures came from,
 * and Skyline's stored host does not resolve at all.
 *
 * READ-ONLY, DELIBERATELY. It writes nothing — no `sources` update, no
 * `pending_changes`, no `last_fetched_at`. It is a measurement, and a
 * measurement that mutates its subject is the thing this project keeps
 * catching. Fixing a citation is a data change and needs a ruling per finding.
 *
 *   node scripts/source-health.mjs            # table + buckets
 *   node scripts/source-health.mjs --json     # machine-readable
 *
 * NO CREDENTIALS. It reads over the anon-visible view of the data via psql, so
 * there is nothing here to leak.
 *
 * ── 200 IS NOT ALIVE ────────────────────────────────────────────────────────
 * The whole point is the difference between a RESPONSE and a SOURCE. A shell
 * returns 200. A page frozen since 2025 returns 200. A page that dropped the
 * sentence we cited returns 200. So every classification below has to answer a
 * harder question than "did it respond": does it still carry the fact we cite
 * it for?
 *
 *   ALIVE       200, substantive, and a fact we cite it for was FOUND in it
 *   MOVED       200, substantive, and none of the facts we cite it for is there
 *   SHELL       200 but too thin to carry anything
 *   BLOCKED     403 / 000, tested with redirects followed
 *   DEAD        404
 *   PRIVATE     data_type 'floor' — a permission-walled document, never fetched
 *   UNCHECKABLE 200, substantive, but nothing it is cited for is a string a
 *               machine can look for. NOT folded into ALIVE — that would be
 *               "it responded, so it is fine", which is the error being
 *               measured.
 *
 * ── NEVER RETYPE A URL ──────────────────────────────────────────────────────
 * Every URL comes from the database. The one time that rule was broken, the
 * detector reported a Westgate 404 that was its own typo — a finding about a
 * URL we do not hold, which is worse than no finding because it looks like one.
 *
 * ── A MATCH IS NOT A FACT ───────────────────────────────────────────────────
 * Probes are specific. A bare `$5` appears on any casino page, so a rake probe
 * looks for the SENTENCE ("rakes 10% up to $5"), not the number. Counting
 * loose matches is how "15 poker mentions" on Skyline turned out to be video
 * poker, a CSS class and an image filename.
 */
import { execFileSync } from 'node:child_process'

const PSQL = process.env.PSQL ?? '/opt/homebrew/opt/postgresql@17/bin/psql'
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const JSON_OUT = process.argv.includes('--json')

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-F', '', '-c', q], { encoding: 'utf8' }).trim()
const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split(''))

/* Identifies itself. Overpass returned 406 to a UA-less request and the failure
   was read as "the API is unreachable" for a week. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/127.0 Safari/537.36'

/** Bytes of TEXT below which a page cannot be carrying a cited fact. The
 *  Orleans shell is ~900 bytes of markup and near-zero text; a real room page
 *  is tens of KB. 1200 sits well clear of both. */
const SHELL_TEXT_FLOOR = 1200

const text = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim()

/**
 * The rake sentence, same shape the detector's `extractRake` looks for.
 *
 * DUPLICATED ON PURPOSE, and the duplication is noted rather than hidden:
 * `scripts/detect-changes.mjs` runs at import time and demands a service-role
 * key, so importing it here would drag a credential requirement into a
 * read-only measurement. If the extractor changes, this must be re-checked —
 * it is a copy, not a shared function.
 */
const rakeSentence = (t) => t.match(/rakes?\s+(?:(\d+)%\s+)?up to \$(\d+(?:\.\d+)?)/i)

/** `dateModified` as pages actually expose it: JSON-LD, then a meta tag. */
function dateModified(html) {
  const ld = html.match(/"dateModified"\s*:\s*"([^"]+)"/)
  if (ld) return ld[1].slice(0, 10)
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:article:modified_time|og:updated_time)["'][^>]+content=["']([^"']+)/i)
  return meta ? meta[1].slice(0, 10) : null
}

/* ── What each source is cited FOR ────────────────────────────────────────────
   Derived from the citation graph, not from a hand-written map. A source's job
   is defined by the rows pointing at it. */
const citations = () => {
  const out = new Map()
  const add = (url, kind, room, probe) => {
    if (!out.has(url)) out.set(url, [])
    out.get(url).push({ kind, room, probe })
  }
  for (const [url, room, tables] of rows(`
    select r.source_url, r.name, coalesce(r.table_count::text,'')
      from rooms r where r.source_url is not null`)) {
    add(url, 'room', room, tables ? { label: `${tables} tables`, re: new RegExp(`\\b${tables}\\b[^.]{0,40}tables?`, 'i') } : null)
  }
  for (const [url, room, stakes] of rows(`
    select c.source_url, r.name, c.stakes_label
      from cash_games c join rooms r on r.id = c.room_id where c.source_url is not null`)) {
    /* THE NUMERIC CORE, NOT OUR LABEL.
       The first version searched for the label verbatim — "$1/3" — and marked
       the Wynn page MOVED. The page says *"...for 1/3, $400 to $1,500 for 2/5
       and $1,000 to $3000 at 5/10"*: the stakes are there, written WITHOUT the
       dollar sign we print. A probe that cannot match the thing it is looking
       for produces a confident wrong verdict, and MOVED is the most expensive
       verdict here — it accuses a live source of having dropped a fact.
       So: pull `N/M` out of the label and allow an optional `$` on either
       number. Word boundaries keep `1/3` from matching inside `21/30`. */
    const core = stakes.match(/(\d+)\s*\/\s*\$?(\d+)/)
    add(url, 'stakes', room, core
      ? { label: stakes, re: new RegExp(`(?<![\\d/])\\$?${core[1]}\\s*/\\s*\\$?${core[2]}(?![\\d/])`) }
      : null)
  }
  for (const [url, room, cap, pct] of rows(`
    select c.rake_source_url, r.name, coalesce(c.rake_cap::text,''), coalesce(c.rake_percent::text,'')
      from cash_games c join rooms r on r.id = c.room_id where c.rake_source_url is not null`)) {
    add(url, 'rake', room, cap ? { label: `rake cap $${Number(cap)}`, cap: Number(cap), pct: pct ? Number(pct) : null, rake: true } : null)
  }
  /* Amenity prose is not a reliable probe — "Free self-park" is OUR label, not
     the page's words — so these are counted as citations and given no probe.
     The amenity label is deliberately not selected: it would be an unused
     binding pretending the check exists. A source cited ONLY for amenities
     therefore lands in UNCHECKABLE, which is the honest bucket. */
  for (const [url, room] of rows(`
    select a.source_url, r.name
      from room_amenities a join rooms r on r.id = a.room_id
      where a.source_url is not null`)) {
    add(url, 'amenity', room, null)
  }
  return out
}

async function fetchOnce(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    const body = await res.text()
    return { status: res.status, body, finalUrl: res.url }
  } catch (e) {
    /* A DNS failure and a refused connection are both "nothing answered", which
       is what 000 means everywhere else in this project's notes. */
    return { status: 0, body: '', finalUrl: url, error: String(e).slice(0, 80) }
  }
}

function classify({ status, body }, probes) {
  if (status === 0) return { bucket: 'BLOCKED', why: 'no response at the network level (000)' }
  if (status === 403) return { bucket: 'BLOCKED', why: '403' }
  if (status === 404) return { bucket: 'DEAD', why: '404' }
  if (status !== 200) return { bucket: 'BLOCKED', why: `HTTP ${status}` }

  const t = text(body)
  if (t.length < SHELL_TEXT_FLOOR) {
    return { bucket: 'SHELL', why: `${t.length} bytes of text — a shell, not a page`, textBytes: t.length }
  }

  const checkable = probes.filter((p) => p.probe)
  if (checkable.length === 0) {
    return { bucket: 'UNCHECKABLE', why: 'nothing it is cited for is a searchable string', textBytes: t.length }
  }

  const found = []
  const missing = []
  for (const { probe } of checkable) {
    let hit = false
    if (probe.rake) {
      /* THE SENTENCE, NOT THE NUMBER. `$5` alone matches a buffet price. */
      const m = rakeSentence(t)
      hit = Boolean(m) && Number(m[2]) === probe.cap
        && (probe.pct == null || m[1] == null || Number(m[1]) === probe.pct)
    } else {
      hit = probe.re.test(t)
    }
    ;(hit ? found : missing).push(probe.label)
  }
  if (found.length === 0) {
    return {
      bucket: 'MOVED',
      why: `serves ${t.length} bytes of text but none of the ${checkable.length} cited fact(s) is in it`,
      textBytes: t.length, found, missing,
    }
  }
  return {
    bucket: 'ALIVE',
    why: `${found.length}/${checkable.length} cited fact(s) still present`,
    textBytes: t.length, found, missing,
  }
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const cited = citations()
/* `sources.room_id` is NULL on all 44 rows, so the room is derived from WHO
   CITES the URL. Reading the column instead printed a dash for every row — a
   report that looked complete and identified nothing. */
const srcRows = rows(`
  select s.url, s.data_type, coalesce(s.label,'')
    from sources s order by s.url, s.data_type`)

/* One fetch per DISTINCT url — 44 rows sit on 20 URLs, and hitting the same
   page three times would be three chances to get three different answers. */
const distinct = [...new Set(srcRows.map(([url]) => url))]
const fetched = new Map()
for (const url of distinct) {
  const isPrivate = srcRows.some(([u, dt]) => u === url && dt === 'floor')
  if (isPrivate) {
    fetched.set(url, { private: true })
    continue
  }
  const res = await fetchOnce(url)
  fetched.set(url, {
    ...res,
    dateModified: res.status === 200 ? dateModified(res.body) : null,
    verdict: classify(res, cited.get(url) ?? []),
  })
}

const report = srcRows.map(([url, dataType, label]) => {
  const f = fetched.get(url)
  const uses = cited.get(url) ?? []
  const roomsCiting = [...new Set(uses.map((u) => u.room))]
  const room = roomsCiting.length === 1 ? roomsCiting[0] : `${roomsCiting.length} rooms`
  const forWhat = [...new Set(uses.map((u) => u.kind))].sort().join('+') || 'nothing'
  if (f.private) {
    return {
      url, dataType, label, room, forWhat, citations: uses.length,
      bucket: 'PRIVATE', why: "data_type 'floor' — permission-walled, deliberately not fetched",
      bytes: null, textBytes: null, dateModified: null,
    }
  }
  return {
    url, dataType, label, room, forWhat, citations: uses.length,
    bucket: f.verdict.bucket, why: f.verdict.why,
    status: f.status, bytes: f.body.length, textBytes: f.verdict.textBytes ?? null,
    dateModified: f.dateModified,
    found: f.verdict.found ?? [], missing: f.verdict.missing ?? [],
  }
})

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`\nSOURCE HEALTH — ${report.length} rows on ${distinct.length} distinct URLs\n`)
  const pad = (s, n) => String(s).padEnd(n).slice(0, n)
  console.log(`  ${pad('BUCKET', 12)}${pad('TYPE', 10)}${pad('ROOM', 20)}${pad('FOR', 16)}${pad('BYTES', 9)}${pad('MODIFIED', 12)}URL`)
  for (const r of report.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.url.localeCompare(b.url))) {
    console.log(`  ${pad(r.bucket, 12)}${pad(r.dataType, 10)}${pad(r.room || '—', 20)}${pad(r.forWhat, 16)}`
      + `${pad(r.textBytes ?? r.bytes ?? '—', 9)}${pad(r.dateModified ?? '—', 12)}${r.url.slice(8, 70)}`)
  }

  const buckets = {}
  for (const r of report) buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1
  console.log('\n  BUCKETS (rows)')
  for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(k, 14)}${v}`)
  }

  /* THE NUMBER THE BRIEF ASKED FOR: how many rendered figures rest on a source
     that is still serving the fact. Counted per CITATION, not per source row —
     one dead page can take thirteen games with it. */
  const perCitation = { ALIVE: 0, other: 0 }
  const byBucket = {}
  for (const [url, uses] of cited) {
    const f = fetched.get(url)
    const b = f?.private ? 'PRIVATE' : f?.verdict.bucket
    byBucket[b] = (byBucket[b] ?? 0) + uses.length
    if (b === 'ALIVE') perCitation.ALIVE += uses.length
    else perCitation.other += uses.length
  }
  console.log('\n  CITED FIGURES (the facts on room detail and /facts)')
  for (const [k, v] of Object.entries(byBucket).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(k, 14)}${v}`)
  }
  const total = perCitation.ALIVE + perCitation.other
  console.log(`\n  ${perCitation.ALIVE} of ${total} cited figures rest on a source still serving the fact `
    + `(${(perCitation.ALIVE / total * 100).toFixed(1)}%)\n`)
}
