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
import { applyTarget } from './db-target.mjs'
import { batch, parseCsv } from '../lib/differ.ts'
import { readFloorSheet } from '../lib/floor-sheet.ts'
import { firstSeenDate, readReviews, storageBlockers } from '../lib/reviews-doc.ts'

const PSQL = resolvePsql()
/* ⚠️ APPLY IS READ FIRST — it decides which database this is even allowed to
   resolve. `DIFFER_APPLY=1` is how the partner's documents reach production
   every morning from .github/workflows/sync.yml, so a writing run demands
   PROD_DATABASE_URL by name; a dry run reads whichever is set and announces it.
   This was `localTarget` for a few hours and would have refused the 05:00 cron
   outright — the sweep classified it from what it does on a laptop rather than
   from where it actually runs. */
const APPLY = process.env.DIFFER_APPLY === '1'
const DB = applyTarget('differ', { writing: APPLY })

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()
const q1 = (s) => `'${String(s).replace(/'/g, "''")}'`

/* The three-part summary, plus the two things a three-part summary cannot say:
   what already agreed (so "0 changes" is distinguishable from "read nothing"),
   and prose found but not applied. */
/* THE DATE COMES FROM THE DATABASE, not the runner's clock — a CI runner is
   UTC and Phil is Pacific, so a job at 05:00 Pacific would stamp tomorrow's
   date for seven hours of every day. */
const TODAY = sql('select current_date::text')

const summary = {
  changed: [], refused: [], unparsed: [], skippedSources: [],
  errors: [], notes: [], descriptions: [], unchanged: 0,
}

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
    adapter: 'floor-sheet',
    fetch: process.env.CID_PARTNER_FLOOR_CSV ?? null,
    document: process.env.CID_PARTNER_FLOOR_DOC ?? null,
  },
  {
    /* ⚠️ HTML, not CSV. The env name says CSV because every source slot here
       does; the adapter is chosen by `adapter`, never by the extension. */
    name: 'partner long-form reviews',
    kind: 'floor',
    adapter: 'reviews-doc',
    fetch: process.env.CID_PARTNER_REVIEWS_CSV ?? null,
    document: process.env.CID_PARTNER_REVIEWS_DOC ?? null,
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

/* ⚠️ THE PUBLISH URL MUST NEVER REACH A CITATION. `document` is what a reader
   following a receipt lands on; `fetch` is a publish artifact — a
   /spreadsheets/d/e/2PACX-.../pub URL that says nothing about who wrote the
   document and may be revoked without the document changing. Asserted here
   rather than trusted, because the two live side by side in one object and a
   one-word slip would be invisible in the rendered receipt. */
function assertCitationIsTheDocument(src, sourceId) {
  const url = sql(`select url from public.sources where id = ${q1(sourceId)}`)
  if (/\/pub\b|\/d\/e\/2PACX/.test(url)) {
    summary.errors.push(
      `${src.name}: the citation resolved to a PUBLISH URL (${url}). A receipt must land on `
      + 'the document, not on a publish artifact. Nothing was written for this source.',
    )
    return false
  }
  return true
}

async function readSource(src) {
  if (!src.fetch) {
    /* NAMED, NOT COUNTED. "2 sources skipped" reads as housekeeping; the name
       is what makes it a blocker somebody can act on. */
    summary.skippedSources.push({ name: src.name, why: 'no URL configured — see the CID_* env vars' })
    return null
  }
  const res = await fetch(src.fetch, { redirect: 'follow' })
  if (!res.ok) { summary.errors.push(`${src.name}: HTTP ${res.status}`); return null }
  const text = await res.text()

  /* THE LOGIN-WALL DETECTOR, KEPT — and now asking the right question per
     source. For the sheet, ANY html is wrong. For the reviews doc html is the
     expected shape, so the question becomes "is this the document or a sign-in
     screen", answered by looking for the document's own content rather than by
     the content type. A sign-in page arrives as a cheerful 200 either way. */
  const looksHtml = /<html|<!doctype html/i.test(text.slice(0, 400))
  if (src.adapter === 'floor-sheet' && looksHtml) {
    summary.errors.push(
      `${src.name}: got an HTML page, not CSV — the URL is almost certainly login-walled. `
      + 'Nothing was scraped; publish it or grant access properly.')
    return null
  }
  if (src.adapter === 'reviews-doc') {
    if (!looksHtml) { summary.errors.push(`${src.name}: expected the published HTML document, got something else`); return null }
    if (/sign in|accounts\.google\.com\/ServiceLogin|Request access/i.test(text.slice(0, 4000))) {
      summary.errors.push(
        `${src.name}: this is a Google sign-in or request-access page, not the document. `
        + 'Nothing was scraped.')
      return null
    }
  }
  return text
}

/** Stage a proposal and let the database decide. */
function stage(change, src, sourceId) {
  const roomId = sql(`select room_id from public.cash_games where id = ${q1(change.targetId)}`)
    || sql(`select room_id from public.room_amenities where id = ${q1(change.targetId)}`)
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

/**
 * STAGE AND APPLY A REVIEW as a room_descriptions row.
 *
 * THROUGH approve_change, LIKE EVERYTHING ELSE. room_descriptions has been on
 * its allowlist since migration 007; what was missing was this — so the differ
 * reported four reviews every morning and landed none of them. A summary line
 * that says the same thing every day stops being read, which makes "proposed,
 * not applied" the worst possible resting state for a daily job.
 *
 * INSERT OR UPDATE, decided by what we hold. `room_descriptions` is unique on
 * room_id, so a second insert for a room would violate the constraint rather
 * than replace anything — and replacing is what a rewritten review means.
 *
 * THE BODY TRAVELS AS BASE64. It is multi-paragraph prose full of apostrophes,
 * quotes and dollar signs going into a shell-invoked psql; every layer of that
 * has its own escaping rules and getting one wrong corrupts an author's words
 * silently. decode/convert_from moves the bytes with no quoting at all.
 *
 * WHAT IS NOT IN THE PAYLOAD: source_url, fetched_at, id, room_id. Those are
 * refused by proposal_field_refusal and written by approve_change from the
 * proposal's own citation — the receipt follows the fact here as everywhere.
 */
function stageDescription(review, src, sourceId) {
  const b64 = Buffer.from(review.body, 'utf8').toString('base64')
  const bodySql = `convert_from(decode('${b64}', 'base64'), 'UTF8')`
  const url = sql(`select url from public.sources where id = ${q1(sourceId)}`)
  const roomId = sql(`select id from public.rooms where slug = ${q1(review.slug)}`)
  const existing = sql(`select id from public.room_descriptions where room_id = ${q1(roomId)}`)

  if (existing === '') {
    return sql(`
      insert into public.pending_changes
        (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
      values ('room_descriptions', null, ${q1(roomId)}, 'insert', null,
              jsonb_build_object(
                'body', ${bodySql},
                'author_kind', 'partner',
                'written_at', ${q1(review.writtenAt)}),
              'differ', ${q1(sourceId)}, ${q1(url)})
      returning id`)
  }
  /* A REWRITE IS AN UPDATE TO `body`, and written_at moves with it — the date
     is first-seen, so new text is newly seen. Two proposals, one row, applied
     together by approve_change_group so a body without its date is not a state
     the database can be left in. */
  const ids = [
    sql(`
      insert into public.pending_changes
        (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
      values ('room_descriptions', ${q1(existing)}, ${q1(roomId)}, 'update', 'body',
              to_jsonb(${bodySql}), 'differ', ${q1(sourceId)}, ${q1(url)})
      returning id`),
    sql(`
      insert into public.pending_changes
        (target_table, target_id, room_id, operation, field, new_value, agent, source_id, source_url)
      values ('room_descriptions', ${q1(existing)}, ${q1(roomId)}, 'update', 'written_at',
              ${q1(JSON.stringify(review.writtenAt))}::jsonb, 'differ', ${q1(sourceId)}, ${q1(url)})
      returning id`),
  ]
  return ids
}

/** Apply a batch. One member -> approve_change; several -> the ordered group. */
function apply(ids, override) {
  const arr = `array[${ids.map((i) => `${q1(i)}::uuid`).join(',')}]`
  if (ids.length === 1) return sql(`select public.approve_change(${q1(ids[0])}::uuid, ${override})`)
  return sql(`select public.approve_change_group(${arr}, ${override})`)
}

/** The roster, in the shape resolveRoom needs. */
function roster() {
  return sql("select slug || '|' || name || '|' || coalesce(property,'') from public.rooms")
    .split('\n').filter(Boolean)
    .map((line) => {
      const [slug, name, property] = line.split('|')
      return { slug, name, property: property || null }
    })
}

/** Every fact the sheet states, aimed at real rows, with what we hold now. */
function aimSheetFacts(facts) {
  const changes = []
  const noTarget = []
  let unchanged = 0

  for (const f of facts) {
    if (f.kind === 'rake') {
      /* ONE ROOM-LEVEL RAKE FANS OUT TO EVERY GAME. Stated in the adapter and
         checked here: the dry run is what proves the reading, because a wrong
         fan-out shows up as dozens of contradictions rather than a no-op. */
      /* ⚠️ NO-LIMIT ONLY. The sheet's "Rake" column is unqualified, and an
         unqualified rake in a Vegas poker room means the no-limit game — the
         limit and Omaha games rake on a different structure entirely ($4/8
         limit does not take $5 and a $3 jackpot drop). Fanning the room figure
         across them would write a confident wrong number onto 37 of the 78
         rows we hold, ten of them at Orleans alone.
         This matches the hand application, which touched Bellagio's four NLH
         rows and left its two PLO and two limit games alone. The first version
         of this fanned to every row and its Bellagio total (8) HAPPENED TO
         MATCH the hand count for entirely different reasons — 8 rows × 1 field
         instead of 4 rows × 2. A matching total is not agreement.
         The non-NLH rows are reported, not silently skipped. */
      const rows = sql(`
        select c.id || '|' || coalesce(c.rake_cap::text,'') || '|' || coalesce(c.jackpot_drop::text,'')
             || '|' || c.stakes_label
          from public.cash_games c join public.rooms r on r.id = c.room_id
         where r.slug = ${q1(f.slug)} and c.game = 'nlh' order by c.stakes_label`).split('\n').filter(Boolean)

      const skipped = sql(`
        select string_agg(c.stakes_label, ', ' order by c.stakes_label)
          from public.cash_games c join public.rooms r on r.id = c.room_id
         where r.slug = ${q1(f.slug)} and c.game <> 'nlh'`)
      if (skipped) {
        summary.unparsed.push({
          source: 'partner floor sheet', line: 0, raw: `${f.slug}: ${skipped}`,
          why: 'the sheet states one unqualified rake and these are not no-limit games — '
             + 'a limit or Omaha game rakes on a different structure, so the room figure is not applied to them',
        })
      }
      for (const row of rows) {
        const [id, cap, drop, stakes] = row.split('|')
        for (const [field, want, have] of [['rake_cap', f.cap, cap], ['jackpot_drop', f.drop, drop]]) {
          if (have !== '' && Number(have) === Number(want)) { unchanged++; continue }
          changes.push({
            table: 'cash_games', targetId: id, field, value: want, from: have === '' ? null : have,
            roomSlug: f.slug, stakesLabel: stakes,
          })
        }
      }
      if (rows.length === 0) noTarget.push({ ...f, why: 'room has no cash games recorded' })
      continue
    }

    if (f.kind === 'phone') {
      const row = sql(`select id || '|' || coalesce(phone,'') from public.rooms where slug = ${q1(f.slug)}`)
      const [id, have] = row.split('|')
      const digits = (x) => String(x).replace(/\D/g, '')
      if (have !== '' && digits(have) === digits(f.value)) { unchanged++; continue }
      changes.push({ table: 'rooms', targetId: id, field: 'phone', value: f.value,
                     from: have === '' ? null : have, roomSlug: f.slug, stakesLabel: null })
      continue
    }

    if (f.kind === 'amenity') {
      const row = sql(`
        select ra.id || '|' || ra.available::text
          from public.room_amenities ra
          join public.rooms r on r.id = ra.room_id
          join public.amenity_types at on at.id = ra.amenity_id
         where r.slug = ${q1(f.slug)} and at.slug = ${q1(f.amenity)}`)
      if (!row) { noTarget.push({ ...f, why: `no ${f.amenity} row for this room` }); continue }
      const [id, have] = row.split('|')
      /* `available::text` renders 'true'/'false', NOT psql's bare 't'/'f' — the
         cast is in the query above. Comparing against 't' made EVERY amenity
         read as false, so the first dry run reported eleven amenities flipping
         false -> true against a database that already said true. Eleven
         confident, plausible, wrong changes; caught only because the run was
         dry and the contradictions were checked against the rows. */
      const had = have === 'true'
      if (had === f.available) { unchanged++; continue }
      changes.push({ table: 'room_amenities', targetId: id, field: 'available', value: f.available,
                     from: had, roomSlug: f.slug, stakesLabel: f.amenity })
      continue
    }

    if (f.kind === 'vendor') {
      /* room_waitlist is NOT on approve_change's allowlist, so this cannot be
         applied through the one write path. Reported, not smuggled in through
         a second one. */
      noTarget.push({ ...f, why: 'room_waitlist is not writable through approve_change — reported, not written' })
    }
  }
  return { changes, noTarget, unchanged }
}

// ─────────────────────────────────────────────────────────────────────
const ROOMS = roster()

for (const src of SOURCES) {
  const text = await readSource(src)
  if (text == null) continue

  const sourceId = APPLY ? resolveSourceRow(src) : null
  if (APPLY && sourceId == null) continue
  if (APPLY && !assertCitationIsTheDocument(src, sourceId)) continue

  // ═══ THE FLOOR SHEET ═══
  if (src.adapter === 'floor-sheet') {
    const read = readFloorSheet(parseCsv(text), ROOMS)
    for (const u of read.unparsed) {
      summary.unparsed.push({ source: src.name, line: 0, raw: `${u.room} · ${u.column}: ${u.raw}`, why: u.why })
    }
    const aimed = aimSheetFacts(read.facts)
    summary.unchanged += aimed.unchanged
    for (const nt of aimed.noTarget) {
      summary.unparsed.push({ source: src.name, line: 0, raw: `${nt.slug} ${nt.kind}`, why: nt.why })
    }

    for (const group of batch(aimed.changes)) {
      if (!APPLY) { for (const c of group) summary.changed.push({ source: src.name, ...c }); continue }
      try {
        const ids = group.map((c) => stage(c, src, sourceId))
        apply(ids, src.kind === 'floor')
        for (const c of group) summary.changed.push({ source: src.name, ...c })
      } catch (e) {
        const msg = String(e.stderr ?? e.message ?? e)
        if (/CID03|precedence:/.test(msg)) {
          const why = (msg.match(/precedence: [^\n]*/) ?? ['refused by precedence'])[0]
          for (const c of group) summary.refused.push({ source: src.name, ...c, why })
        } else {
          summary.errors.push(`${src.name}: ${msg.split('\n').find((l) => /ERROR/.test(l)) ?? msg.slice(0, 200)}`)
        }
      }
    }
    continue
  }

  // ═══ THE REVIEWS DOCUMENT ═══
  if (src.adapter === 'reviews-doc') {
    const read = readReviews(text, ROOMS)
    for (const n of read.notes) summary.notes.push({ source: src.name, ...n })
    for (const r of read.reviews) {
      /* ═══ written_at IS FIRST-SEEN, AND IT MOVES WHEN THE TEXT MOVES ═══
         The document has no authored date and none is invented (migration 009).
         So: if we already hold this room's description and the body is
         BYTE-IDENTICAL, the stored date stands — re-reading an unchanged review
         every morning must not make it look newer every morning, which is the
         failure that would make the date worthless within a week. If the text
         differs, this is the first time we have seen THIS text, and today is
         the honest answer. */
      const held = sql(`
        select coalesce(d.written_at::text,'') || chr(1) || coalesce(d.body,'')
          from public.room_descriptions d join public.rooms r on r.id = d.room_id
         where r.slug = ${q1(r.slug)}`)
      const [heldDate, heldBody] = held ? held.split('\u0001') : ['', null]
      const dated = firstSeenDate(
        heldBody == null ? null : { body: heldBody, writtenAt: heldDate },
        r.body, TODAY)

      const entry = {
        source: src.name, ...r,
        blockers: storageBlockers(r, 'partner'),
        writtenAt: dated.writtenAt,
        state: dated.state,
      }

      /* UNCHANGED TEXT IS NOT A CHANGE. Re-staging an identical review every
         morning would write a change_log entry a day for prose nobody touched,
         and bury the day something actually moved. */
      if (dated.state === 'unchanged') { entry.applied = 'unchanged'; summary.descriptions.push(entry); continue }
      if (entry.blockers.length > 0) { entry.applied = 'blocked'; summary.descriptions.push(entry); continue }
      if (!APPLY) { entry.applied = 'dry-run'; summary.descriptions.push(entry); continue }

      try {
        const staged = stageDescription({ ...r, writtenAt: dated.writtenAt }, src, sourceId)
        const ids = Array.isArray(staged) ? staged : [staged]
        apply(ids, src.kind === 'floor')
        entry.applied = dated.state === 'new' ? 'inserted' : 'rewritten'
      } catch (e) {
        const msg = String(e.stderr ?? e.message ?? e)
        if (/CID03|precedence:/.test(msg)) {
          entry.applied = 'refused by precedence'
          summary.refused.push({
            source: src.name, roomSlug: r.slug, stakesLabel: null, field: 'description',
            from: dated.state, value: 'partner review',
            why: (msg.match(/precedence: [^\n]*/) ?? ['refused by precedence'])[0],
          })
        } else {
          entry.applied = 'FAULT'
          summary.errors.push(`${src.name} (${r.slug} description): ${msg.split('\n').find((l) => /ERROR/.test(l)) ?? msg.slice(0, 200)}`)
        }
      }
      summary.descriptions.push(entry)
    }
    continue
  }
}

// ─────────────────────────────────────────────────────────────────────
// THE SUMMARY. Read, not actioned.
const fmt = (c) => {
  const where = c.stakesLabel ? ` ${c.stakesLabel}` : ''
  return `${c.roomSlug}${where} · ${c.field}: ${c.from ?? '—'} → ${c.value}`
}

console.log(`\n══ CHECK IT DOWN — source sync ══${APPLY ? '' : '   (DRY RUN — nothing was written)'}`)

/* GAP-FILLS AND CONTRADICTIONS ARE DIFFERENT NEWS, and lumping them together
   is how a real disagreement hides inside a long list. A row we hold nothing
   for is the sheet telling us something new; a row we hold a DIFFERENT value
   for means the sheet and the database disagree, and on a source already
   applied by hand that means the parse is reading it differently than a person
   did. Only the second is a finding. */
const gapFills = summary.changed.filter((c) => c.from == null || c.from === '')
const contradictions = summary.changed.filter((c) => !(c.from == null || c.from === ''))

console.log(`\nCHANGED — CONTRADICTIONS (${contradictions.length})`)
if (contradictions.length === 0) console.log('  none — the parse agrees with every value already applied')
for (const c of contradictions) console.log(`  ${fmt(c)}   [${c.source}]`)

console.log(`\nCHANGED — FILLS A GAP, we held nothing (${gapFills.length})`)
if (gapFills.length === 0) console.log('  none')
for (const c of gapFills) console.log(`  ${fmt(c)}   [${c.source}]`)

console.log(`\nALREADY AGREED (${summary.unchanged})   — printed so "0 changes" cannot be confused with "read nothing"`)

console.log(`\nREFUSED BY PRECEDENCE (${summary.refused.length})`)
if (summary.refused.length === 0) console.log('  none')
for (const c of summary.refused) console.log(`  ${fmt(c)}\n      ${c.why}`)

if (summary.descriptions.length > 0) {
  const landed = summary.descriptions.filter((d) => d.applied === 'inserted' || d.applied === 'rewritten').length
  console.log(`\nPROSE — ${summary.descriptions.length} reviews read, ${landed} landed`)
  for (const d of summary.descriptions) {
    console.log(`  ${d.slug}  "${d.heading}"  ${d.words} words  ·  ${d.state} → ${d.applied}, written_at ${d.writtenAt} (first-seen)`)
    if (d.figures.length > 0) {
      console.log(`      keeps ${d.figures.length} figures verbatim: ${[...new Set(d.figures)].join(', ')}`)
    }
    for (const b of d.blockers) console.log(`      ⚠ CANNOT STORE: ${b}`)
  }
}

console.log(`\nCOULD NOT READ (${summary.unparsed.length})`)
if (summary.unparsed.length === 0) console.log('  none')
for (const u of summary.unparsed) console.log(`  ${u.source}: ${u.raw}\n      ${u.why}`)

for (const n of summary.notes) console.log(`\nNOTE [${n.source}] ${n.what}\n      ${n.why}`)

if (summary.skippedSources.length > 0) {
  console.log(`\n⚠️  SOURCES NOT READ (${summary.skippedSources.length})`)
  for (const s of summary.skippedSources) console.log(`  ${s.name}: ${s.why}`)
}

if (summary.errors.length > 0) {
  console.log(`\n✖ FAULTS (${summary.errors.length}) — these are bugs, not law`)
  for (const e of summary.errors) console.log(`  ${e}`)
}

/* ═══ A RUN THAT READ NOTHING MUST NOT LOOK LIKE A QUIET DAY ═══
   Every section above prints a cheerful zero when no source was reachable, and
   "nothing changed" is exactly what a healthy run looks like. That is the
   vacuous pass this project keeps finding, and on a DAILY job it is the worst
   version of it: the summary keeps arriving, keeps saying nothing moved, and
   nobody notices for a month. So a run that read no source at all is a
   FAILURE, however tidy its output. */
const sourcesRead = SOURCES.length - summary.skippedSources.length
  - summary.errors.filter((e) => /HTTP |login-walled|sign-in|not the document/.test(e)).length
if (sourcesRead <= 0) {
  console.log('✖ NO SOURCE WAS READ. This run proves nothing — failing rather than reporting a quiet zero.\n')
  process.exit(1)
}

console.log()
process.exit(summary.errors.length > 0 ? 1 : 0)
