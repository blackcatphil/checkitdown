#!/usr/bin/env node
/**
 * THE SELF-UPDATING PIPELINE. Reads the sources, diffs against prod, applies
 * under the precedence law, and prints a SUMMARY.
 *
 * ═══ IT WRITES THROUGH approve_change AND NOWHERE ELSE ═══
 *
 * Every citation rule, the receipt-follows-the-fact move, the change_log entry
 * and the precedence law itself live in that function. This job stages a
 * `pending_changes` row and calls it — the same door the queue used. There is
 * no UPDATE statement anywhere in this file, deliberately: a second write path
 * is how those rules rot, and they would rot silently, because the facts would
 * still look fine.
 *
 * The queue rows it stages are marked `applied` or `rejected` by that function
 * as usual, so the audit trail is identical to a human approval. What is gone
 * is the WAITING.
 *
 * ═══ THE OUTPUT IS A SUMMARY, NOT A TO-DO LIST ═══
 *
 * Three sections: what changed, what precedence refused and why, what could not
 * be parsed. Phil reads it. Nothing in it is an action item — a refusal by
 * precedence is the law working, not a decision anybody needs to make.
 *
 * ═══ ⚠️ THE DOC ACCESS BLOCKER ═══
 *
 * The partner documents are Google files behind a permission wall. This process
 * has no credential for them and MUST NOT invent one. It reads whatever URL it
 * is given for each source and fails loudly, by name, when a source has no URL
 * configured. See the report accompanying this commit for exactly what access
 * is needed; until then the partner adapter has no URL and the job says so in
 * the summary rather than reporting a quiet zero.
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'
import { batch, diff, parseCsv, toFacts } from '../lib/differ.ts'

const PSQL = resolvePsql()
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const APPLY = process.env.DIFFER_APPLY === '1'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()
const q1 = (s) => `'${String(s).replace(/'/g, "''")}'`

/**
 * THE SOURCES. Each needs a URL that this process can fetch WITHOUT a login.
 * `kind` is the precedence rank and must match the `data_type` on the matching
 * `sources` row — the database compares against that, not against this file.
 */
/*
 * `fetch` is where the CSV is read from; `document` is the CANONICAL URL that
 * gets written into the citation, and it must already exist as a row in
 * `sources` with this `data_type`.
 *
 * ⚠️ THE TWO ARE SEPARATE BECAUSE CONFLATING THEM MISATTRIBUTES FACTS. The
 * first version of this file resolved the citation with
 * `select id from sources where data_type = kind order by id limit 1` — any
 * row of the right type — and on its first live run it wrote a Mandalay Bay
 * URL onto an ARIA rake. Every artefact was internally consistent: the value
 * was right, the receipt was a real source of the right kind, the change_log
 * agreed with both. It was still a lie about where the number came from, which
 * is the Westgate class exactly, produced by the pipeline built to prevent it.
 *
 * So the citation is now looked up by URL, and a source this job cannot match
 * to a `sources` row is REFUSED rather than cited to something plausible.
 */
const SOURCES = [
  {
    name: 'partner floor sheet',
    kind: 'floor',
    fetch: process.env.CID_PARTNER_FLOOR_CSV ?? null,
    document: process.env.CID_PARTNER_FLOOR_DOC ?? null,
  },
  {
    name: 'partner long-form reviews',
    kind: 'floor',
    fetch: process.env.CID_PARTNER_REVIEWS_CSV ?? null,
    document: process.env.CID_PARTNER_REVIEWS_DOC ?? null,
  },
  {
    name: 'web research sheet',
    kind: 'cash',
    fetch: process.env.CID_WEB_RESEARCH_CSV ?? null,
    document: process.env.CID_WEB_RESEARCH_DOC ?? null,
  },
]

/** The `sources` row a citation will point at, or null with a named fault. */
function resolveSourceRow(src) {
  if (!src.document) {
    summary.errors.push(
      `${src.name}: no canonical document URL configured. A fact may not be cited to `
      + 'a source picked for having the right data_type — that is how a room ends up '
      + "citing another room's page. Set its *_DOC env var to the URL held in `sources`.",
    )
    return null
  }
  const id = sql(
    `select id from public.sources where url = ${q1(src.document)} and data_type = ${q1(src.kind)}`)
  if (!id) {
    summary.errors.push(
      `${src.name}: ${src.document} is not in \`sources\` with data_type ${src.kind}. `
      + 'Add it there first — precedence is read from that row, not from this file.',
    )
    return null
  }
  return id
}

const summary = { changed: [], refused: [], unparsed: [], skippedSources: [], errors: [] }

async function readSource(src) {
  if (!src.fetch) {
    /* NAMED, NOT COUNTED. "2 sources skipped" is the kind of line that reads as
       housekeeping; the name is what makes it a blocker somebody can act on. */
    summary.skippedSources.push({ name: src.name, why: 'no URL configured — see CID_* env vars and the access note' })
    return null
  }
  const res = await fetch(src.fetch, { redirect: 'follow' })
  if (!res.ok) {
    summary.errors.push(`${src.name}: HTTP ${res.status}`)
    return null
  }
  const text = await res.text()
  /* A LOGIN PAGE IS NOT A CSV, and it arrives with a cheerful 200. Without this
     the parser would read HTML, find no header, and report "could not parse" —
     true, useless, and pointing at the wrong problem. */
  if (/<html|<!doctype html/i.test(text.slice(0, 400))) {
    summary.errors.push(
      `${src.name}: got an HTML page, not CSV — the URL is almost certainly login-walled. `
      + 'Nothing was scraped; grant access properly (see the access note).',
    )
    return null
  }
  return text
}

/** Every room slug we hold, so an unknown one is reported rather than created. */
function knownSlugs() {
  return new Set(sql('select slug from public.rooms').split('\n').filter(Boolean))
}

/** The facts as prod currently holds them, in the differ's shape. */
function currentFacts() {
  const rows = sql(`
    select r.slug, 'rooms', '', 'table_count', coalesce(r.table_count::text, ''), r.id::text from public.rooms r
    union all
    select r.slug, 'rooms', '', 'hours_note', coalesce(r.hours_note, ''), r.id::text from public.rooms r
    union all
    select r.slug, 'cash_games', c.stakes_label, f.field, f.val, c.id::text
      from public.cash_games c join public.rooms r on r.id = c.room_id
      cross join lateral (values
        ('rake_type', coalesce(c.rake_type::text, '')),
        ('rake_percent', coalesce(c.rake_percent::text, '')),
        ('rake_cap', coalesce(c.rake_cap::text, '')),
        ('jackpot_drop', coalesce(c.jackpot_drop::text, '')),
        ('min_buy_in', coalesce(c.min_buy_in::text, '')),
        ('max_buy_in', coalesce(c.max_buy_in::text, ''))
      ) as f(field, val)`)
  return rows.split('\n').filter(Boolean).map((line) => {
    const [roomSlug, table, stakesLabel, field, value, targetId] = line.split('|')
    return {
      roomSlug, table, stakesLabel: stakesLabel || null, field,
      value: value === '' ? null : value, targetId,
    }
  })
}

/** Stage a proposal and let the database decide. */
function stage(change, src, sourceId) {
  const roomId = sql(`select room_id from public.cash_games where id = ${q1(change.targetId)}`)
    || sql(`select id from public.rooms where id = ${q1(change.targetId)}`)
  const url = sql(`select url from public.sources where id = ${q1(sourceId)}`)
  const value = change.value === null ? 'null' : JSON.stringify(String(change.value))
  return sql(`
    insert into public.pending_changes
      (target_table, target_id, room_id, operation, field, old_value, new_value,
       agent, source_id, source_url)
    values (${q1(change.table)}, ${q1(change.targetId)}, ${q1(roomId)}, 'update',
            ${q1(change.field)}, ${q1(JSON.stringify(String(change.from ?? '')))}::jsonb,
            ${q1(value)}::jsonb, 'differ', ${q1(sourceId)}, ${q1(url)})
    returning id`)
}

/** Apply a batch. One member -> approve_change; several -> the ordered group. */
function apply(ids, override) {
  const arr = `array[${ids.map((i) => `${q1(i)}::uuid`).join(',')}]`
  if (ids.length === 1) return sql(`select public.approve_change(${q1(ids[0])}::uuid, ${override})`)
  return sql(`select public.approve_change_group(${arr}, ${override})`)
}

// ─────────────────────────────────────────────────────────────────────
const slugs = knownSlugs()
const current = currentFacts()

for (const src of SOURCES) {
  const text = await readSource(src)
  if (text == null) continue

  /* Resolved BEFORE anything is staged: a source whose citation cannot be
     established writes nothing at all, rather than writing correct values with
     a receipt that points somewhere else. */
  const sourceId = APPLY ? resolveSourceRow(src) : null
  if (APPLY && sourceId == null) continue

  const { facts, unparsed } = toFacts(parseCsv(text), slugs)
  for (const u of unparsed) summary.unparsed.push({ source: src.name, ...u })

  const d = diff(facts, current)
  for (const nt of d.noTarget) {
    summary.unparsed.push({
      source: src.name, line: 0, raw: `${nt.roomSlug} ${nt.stakesLabel ?? ''} ${nt.field}`,
      why: 'no such row in prod — a game we do not hold, or a stakes label that has moved',
    })
  }

  for (const group of batch(d.changes)) {
    if (!APPLY) {
      for (const c of group) {
        summary.changed.push({ source: src.name, ...c, dryRun: true })
      }
      continue
    }
    let ids = []
    try {
      ids = group.map((c) => stage(c, src, sourceId))
      /* THE OVERRIDE IS ONLY EVER FOR floor -> floor, and it means "this newer
         document supersedes the earlier visit". It is never passed for a web
         source, because web -> floor must refuse and no flag may lift it. */
      apply(ids, src.kind === 'floor')
      for (const c of group) summary.changed.push({ source: src.name, ...c })
    } catch (e) {
      const msg = String(e.stderr ?? e.message ?? e)
      /* SQLSTATE CID03 is the precedence refusal — the law working. Anything
         else is a fault, and the two must not be reported as the same thing:
         one is a summary line, the other is a bug. */
      if (/CID03|precedence:/.test(msg)) {
        const why = (msg.match(/precedence: [^\n]*/) ?? ['refused by precedence'])[0]
        for (const c of group) summary.refused.push({ source: src.name, ...c, why })
      } else {
        summary.errors.push(`${src.name}: ${msg.split('\n').find((l) => /ERROR/.test(l)) ?? msg.slice(0, 200)}`)
      }
      /* Leave the staged rows behind as `pending` — they are the audit trail of
         what the law declined, and /admin/review is still there to look at. */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// THE SUMMARY. Read, not actioned.
const fmt = (c) => `${c.roomSlug}${c.stakesLabel ? ` ${c.stakesLabel}` : ''} · ${c.field}: ${c.from ?? '—'} → ${c.value ?? '—'}`

console.log(`\n══ CHECK IT DOWN — source sync ══${APPLY ? '' : '   (DRY RUN — set DIFFER_APPLY=1 to write)'}`)

console.log(`\nCHANGED (${summary.changed.length})`)
for (const c of summary.changed) console.log(`  ${fmt(c)}   [${c.source}]`)
if (summary.changed.length === 0) console.log('  nothing moved')

console.log(`\nREFUSED BY PRECEDENCE (${summary.refused.length})`)
for (const c of summary.refused) console.log(`  ${fmt(c)}\n      ${c.why}`)
if (summary.refused.length === 0) console.log('  none')

console.log(`\nCOULD NOT READ (${summary.unparsed.length})`)
for (const u of summary.unparsed) console.log(`  ${u.source} line ${u.line}: ${u.why}\n      ${u.raw}`)
if (summary.unparsed.length === 0) console.log('  none')

if (summary.skippedSources.length > 0) {
  console.log(`\n⚠️  SOURCES NOT READ (${summary.skippedSources.length})`)
  for (const s of summary.skippedSources) console.log(`  ${s.name}: ${s.why}`)
}

if (summary.errors.length > 0) {
  console.log(`\n✖ FAULTS (${summary.errors.length}) — these are bugs, not law`)
  for (const e of summary.errors) console.log(`  ${e}`)
}

console.log()
/* A FAULT FAILS THE RUN; a precedence refusal does not. The whole point of the
   law is that a refusal is a normal outcome nobody has to action. */
process.exit(summary.errors.length > 0 ? 1 : 0)
