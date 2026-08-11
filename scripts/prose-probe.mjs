#!/usr/bin/env node
/**
 * THE PROSE WRITE PATH, GATED — insert, idempotence, rewrite.
 *
 * ═══ WHY THIS FILE EXISTS ═══
 *
 * `scripts/differ.mjs` runs against PRODUCTION every morning at 05:00 Pacific,
 * unattended, with `DIFFER_APPLY=1`. Its prose branch inserts a description,
 * declines to rewrite one that has not changed, and replaces one that has. All
 * three were verified by hand, once, on 2026-08-11 — and nothing in CI has ever
 * executed that branch. The daily job was the only thing running it, on the one
 * database where being wrong is expensive.
 *
 * The failure that keeps this awake is the SECOND one. An insert that breaks is
 * loud: the summary says FAULT and the run goes red. An idempotence check that
 * breaks is silent and cumulative — every morning writes a change_log entry for
 * prose nobody touched, `written_at` marches forward, and within a week every
 * review on the site reads "written today". The signal is still there, still
 * visible, still dated, and has quietly stopped meaning anything. Nothing about
 * that looks like a failure from the outside.
 *
 * ═══ IT DRIVES THE REAL DIFFER, NOT A COPY OF IT ═══
 *
 * The tempting shape is a probe that stages a `pending_changes` row and calls
 * `approve_change` itself. That would test a REIMPLEMENTATION of the write path
 * — and `differ.mjs` opens by warning that a second write path is how these
 * rules rot silently. A gate built out of one would be the same mistake wearing
 * a test's name.
 *
 * So this spawns `scripts/differ.mjs` as a subprocess, exactly as the cron job
 * does, and feeds it a fixture through the one input it already has: the source
 * URL. The URL is a `data:` URL, which `fetch` resolves with no network — so
 * `readSource`, the login-wall detector, `readReviews`, `firstSeenDate`,
 * `storageBlockers`, `stageDescription`, `approve_change_group` and the
 * precedence law all run for real, in the order the cron job runs them.
 *
 * NOTHING WAS ADDED TO THE WRITE PATH TO MAKE THIS TESTABLE. There is no test
 * hook, no injected adapter and no `if (process.env.TEST)` branch in
 * `differ.mjs` — a hatch like that is untested code on the one path that writes
 * to production. `data:` is a URL scheme, and the differ was always willing to
 * fetch whatever URL it was handed.
 *
 * ═══ IT STAGES ITS OWN FIXTURE ═══
 *
 * The mixed-suite lesson: a probe that measures whatever the database happens
 * to hold reports on today's data, not on the code. `room_descriptions` is
 * empty in the seed, so a run against it would insert, pass, and prove nothing
 * about the rewrite path — there would be nothing to rewrite. Every state this
 * file asserts is one it put there, and it puts the database back afterwards by
 * snapshot rather than by assumption.
 *
 *   PSQL=... node scripts/prose-probe.mjs
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'
import { readReviews } from '../lib/reviews-doc.ts'

const PSQL = resolvePsql()
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()
const q1 = (s) => `'${String(s).replace(/'/g, "''")}'`

let failed = 0
const ok = (cond, msg, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

/* ── The fixture ──────────────────────────────────────────────────────────
   SOUTH POINT, chosen because it carries no description in the seed and its
   name resolves to exactly one room. The heading has to be five words or
   fewer and be followed by at least forty, or `readReviews` treats it as an
   index entry rather than a review — the same rule that keeps the document's
   table of contents from becoming seventeen empty reviews. */
const SLUG = 'south-point'
const HEADING = 'South Point'

const para = (n) => (
  `Paragraph ${n} of a fixture review, written long enough to clear the forty-word `
  + 'floor that separates a real review from an index entry at the top of the '
  + 'document, because a heading followed by a short line is exactly the shape '
  + 'this parser is built to refuse, and a fixture that cannot exhibit that '
  + 'distinction would not be testing it at all.'
)

/* FIGURES ARE IN THE PROSE ON PURPOSE. A partner review is quoted material and
   keeps its currency verbatim — migration 009 narrowed the no-typed-currency
   constraint to our OWN prose for exactly that reason. A fixture with no
   figures in it would never touch that branch, and the day somebody re-widens
   the constraint this run would go red where a clean fixture would not. */
const REVIEW_ONE = `${para('one')} The smallest game is $1/2 and the room takes $5 maximum.\n\n${para('two')}`
const REVIEW_TWO = `${para('one, rewritten')} The room now spreads $1/3 instead.\n\n${para('two, rewritten')}`

const docHtml = (body) => {
  const ps = body.split('\n\n').map((p) => `<p>${p}</p>`).join('')
  return '<!doctype html><html><head><title>Partner reviews</title></head><body>'
    + '<p>Write all the long form reviews</p>'
    + `<p>${HEADING}</p>${ps}`
    + '</body></html>'
}

const dataUrl = (html) => `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`

/* THE CITATION IS THE REAL PARTNER DOCUMENT, already in `sources` from the
   seed. Nothing is inserted there: `resolveSourceRow` and
   `assertCitationIsTheDocument` are two of the guards under test, and pointing
   them at a row this file created would be marking its own homework. */
const DOC = sql("select url from public.sources where data_type = 'floor' and url like '%/document/%' limit 1")

/* ── Snapshot, so the database is put back by record rather than by belief ── */
const SNAP = 'cid_prose_probe_snapshot'
const snapshot = () => sql(`
  drop schema if exists ${SNAP} cascade;
  create schema ${SNAP};
  create table ${SNAP}.room_descriptions as select id from public.room_descriptions;
  create table ${SNAP}.change_log      as select id from public.change_log;
  create table ${SNAP}.pending_changes as select id from public.pending_changes;`)
const restore = () => sql(`
  delete from public.room_descriptions d
    where not exists (select 1 from ${SNAP}.room_descriptions s where s.id = d.id);
  delete from public.change_log c
    where not exists (select 1 from ${SNAP}.change_log s where s.id = c.id);
  delete from public.pending_changes p
    where not exists (select 1 from ${SNAP}.pending_changes s where s.id = p.id);
  drop schema if exists ${SNAP} cascade;`)

/** Run the real differ, applying, with the fixture as its reviews source. */
function runDiffer(html) {
  return execFileSync('node', ['scripts/differ.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PSQL,
      DATABASE_URL: DB,
      DIFFER_APPLY: '1',
      CID_PARTNER_REVIEWS_CSV: dataUrl(html),
      CID_PARTNER_REVIEWS_DOC: DOC,
      /* The floor sheet is left unconfigured deliberately: it reports as a
         NAMED skipped source, which is the state this probe wants — one source
         read is enough for the differ's own "a run that read nothing must
         fail" guard, and reaching for the real sheet would need the network. */
      CID_PARTNER_FLOOR_CSV: '',
      CID_PARTNER_FLOOR_DOC: '',
    },
  })
}

/**
 * What the database holds for the room under test, or null.
 *
 * THE BODY COMES BACK AS BASE64 for the same reason it goes IN as base64: it is
 * multi-paragraph prose with embedded newlines. `psql -qtAX` prints those
 * newlines raw, so any delimiter-and-split scheme is guessing where a field
 * ends, and the outer `.trim()` would silently eat whitespace the parser had
 * deliberately kept. Read as bytes, compared as bytes.
 */
const held = () => {
  if (rowsFor() === 0) return null
  const one = (expr) => sql(`
    select ${expr} from public.room_descriptions d join public.rooms r on r.id = d.room_id
     where r.slug = ${q1(SLUG)}`)
  return {
    body: Buffer.from(one("encode(convert_to(d.body,'UTF8'),'base64')").replace(/\s+/g, ''), 'base64').toString('utf8'),
    writtenAt: one('d.written_at::text'),
    authorKind: one('d.author_kind::text'),
    sourceUrl: one("coalesce(d.source_url,'')"),
    /* 'true', NOT 't'. `boolean::text` renders the long spelling; the short one
       is psql's own column formatting for an uncast boolean. Comparing to 't'
       reported every description as having no fetched_at, which sent this probe
       hunting a provenance bug in `approve_change` that was never there. */
    hasFetched: one('(d.fetched_at is not null)::text') === 'true',
  }
}

const rowsFor = () => Number(sql(`
  select count(*) from public.room_descriptions d join public.rooms r on r.id = d.room_id
   where r.slug = ${q1(SLUG)}`))

const logCount = () => Number(sql("select count(*) from public.change_log where target_table = 'room_descriptions'"))
const pendingCount = () => Number(sql("select count(*) from public.pending_changes where target_table = 'room_descriptions'"))

console.log('\nPROSE WRITE PATH\n')

/* Read BEFORE the snapshot schema exists, so the restore can be checked against
   numbers rather than against the snapshot that performed it. */
const CENSUS_BEFORE = [
  sql('select count(*) from public.room_descriptions'),
  sql('select count(*) from public.change_log'),
  sql('select count(*) from public.pending_changes'),
].join('/')

snapshot()
try {
  ok(DOC !== '' && !/\/pub\b|\/d\/e\/2PACX/.test(DOC),
    'the citation resolves to the partner DOCUMENT, not a publish artifact', DOC || 'NO SOURCE ROW')

  /* THE FIXTURE PARSES — asserted with the SHIPPING parser, before anything is
     measured against it. A fixture the parser reads as zero reviews would make
     every assertion below pass against an untouched database. */
  const rooms = sql("select slug || '|' || name || '|' || coalesce(property,'') from public.rooms")
    .split('\n').filter(Boolean)
    .map((l) => { const [slug, name, property] = l.split('|'); return { slug, name, property: property || null } })
  const parsed = readReviews(docHtml(REVIEW_ONE), rooms)
  ok(parsed.reviews.length === 1 && parsed.reviews[0].slug === SLUG,
    'the fixture reads as exactly one review, for the intended room',
    `${parsed.reviews.length} review(s): ${parsed.reviews.map((r) => r.slug).join(', ') || 'none'}`)
  /* The EXPECTED body is what the shipping parser produced, not a string this
     file assembled — paragraphs are whitespace-collapsed and entity-decoded on
     the way through, and a hand-built expectation would be asserting against
     this probe's idea of the parser. */
  const EXPECT_ONE = parsed.reviews[0]?.body ?? ''
  const EXPECT_TWO = readReviews(docHtml(REVIEW_TWO), rooms).reviews[0]?.body ?? ''
  ok(EXPECT_ONE !== '' && EXPECT_TWO !== '' && EXPECT_ONE !== EXPECT_TWO,
    'and the rewrite fixture is genuinely different text', `${EXPECT_ONE.length} vs ${EXPECT_TWO.length} chars`)

  const TODAY = sql('select current_date::text')

  /* ═══ 1. INSERT ═══════════════════════════════════════════════════════ */
  ok(rowsFor() === 0, 'the room starts with no description, so the insert is a real insert')
  const logBefore = logCount()

  const out1 = runDiffer(docHtml(REVIEW_ONE))
  const after1 = held()
  ok(/→ inserted/.test(out1), 'the differ reports an INSERT',
    (out1.match(/^ {2}south-point.*$/m) ?? ['no prose line in the summary'])[0].trim())
  ok(after1 !== null && after1.body === EXPECT_ONE,
    'the prose landed, byte for byte as the parser read it',
    after1 === null ? 'NO ROW' : `${after1.body.length} chars`)
  ok(after1?.writtenAt === TODAY, 'written_at is today — first-seen, and this is the first time',
    `${after1?.writtenAt} vs ${TODAY}`)
  ok(after1?.authorKind === 'partner', 'stored as partner prose, not as ours', after1?.authorKind)
  /* THE RECEIPT FOLLOWS THE FACT. `approve_change` writes the citation from the
     proposal's own source, and the differ is forbidden to put it in the
     payload — so a description carrying the right URL proves that path ran
     rather than that this probe supplied it. */
  ok(after1?.sourceUrl === DOC && after1?.hasFetched,
    'and it carries the document as its citation, written by approve_change',
    `${after1?.sourceUrl || 'none'} · fetched_at ${after1?.hasFetched ? 'set' : 'NULL'}`)
  const logAfter1 = logCount()
  ok(logAfter1 === logBefore + 1, 'exactly one change_log entry was written for it',
    `${logBefore} → ${logAfter1}`)
  ok(sql(`select operation from public.change_log where target_table = 'room_descriptions'
            order by applied_at desc limit 1`) === 'insert',
  'and it is recorded as an insert')

  /* ═══ 2. IDEMPOTENCE ══════════════════════════════════════════════════
     BACKDATED FIRST, and that is the whole design of this scenario. Run one
     stamped today; a second run today would also stamp today, so "the date did
     not move" would be true of a completely broken implementation. Moving the
     held date back ten days makes the two outcomes distinguishable: a correct
     run leaves it at ten days ago, a re-stamping one drags it to today. */
  const BACK = sql('select (current_date - 10)::text')
  sql(`update public.room_descriptions set written_at = ${q1(BACK)}
        where room_id = (select id from public.rooms where slug = ${q1(SLUG)})`)
  const logBefore2 = logCount()
  const pendBefore2 = pendingCount()

  const out2 = runDiffer(docHtml(REVIEW_ONE))
  const after2 = held()
  ok(/→ unchanged/.test(out2), 'a second identical run reports UNCHANGED',
    (out2.match(/^ {2}south-point.*$/m) ?? ['no prose line'])[0].trim())
  ok(logCount() === logBefore2,
    'and writes NO change_log entry — an unchanged re-read is not a change',
    `${logBefore2} → ${logCount()}`)
  /* PENDING_CHANGES TOO. A proposal that is staged and then applied leaves the
     facts identical and the queue one row longer; counting only change_log
     would call that clean. */
  ok(pendingCount() === pendBefore2,
    'and stages NO proposal either — nothing was written down at all',
    `${pendBefore2} → ${pendingCount()}`)
  ok(after2?.writtenAt === BACK,
    'written_at DID NOT MOVE — re-reading the same paragraph every morning must not make it look newer',
    `${after2?.writtenAt}, backdated to ${BACK}`)
  ok(after2?.body === EXPECT_ONE, 'and the body is untouched')

  /* ═══ 3. REWRITE ══════════════════════════════════════════════════════ */
  const logBefore3 = logCount()
  const out3 = runDiffer(docHtml(REVIEW_TWO))
  const after3 = held()
  ok(/→ rewritten/.test(out3), 'changed text reports a REWRITE',
    (out3.match(/^ {2}south-point.*$/m) ?? ['no prose line'])[0].trim())
  /* THE ASSERTION THE UNIQUE CONSTRAINT MAKES INTERESTING. `room_descriptions`
     is unique on room_id, so a second INSERT does not duplicate — it RAISES,
     and the differ would report a FAULT and leave the old prose in place. Both
     halves are checked: one row, and the row actually moved. */
  ok(rowsFor() === 1, 'still exactly ONE description for the room — replaced, not duplicated', `${rowsFor()} rows`)
  ok(after3?.body === EXPECT_TWO, 'and it holds the NEW text',
    after3?.body === EXPECT_ONE ? 'still the old body — the update did not apply' : `${after3?.body.length} chars`)
  ok(after3?.writtenAt === TODAY,
    'written_at MOVED to today — new text is newly seen',
    `${BACK} → ${after3?.writtenAt}`)
  const fields = sql(`
    select coalesce(field,'-') from public.change_log
     where target_table = 'room_descriptions' order by applied_at desc limit 2`)
    .split('\n').sort().join(',')
  ok(logCount() === logBefore3 + 2 && fields === 'body,written_at',
    'two change_log entries: the body and the date, applied together',
    `${logBefore3} → ${logCount()}, fields [${fields}]`)
  /* NOT A FAULT. The differ prints faults in their own section and exits
     non-zero; a rewrite that raised would still leave one row and could sail
     past the count assertions above. */
  ok(!/✖ FAULTS/.test(out3), 'and the run reported no faults',
    (out3.match(/^ {2}.*(ERROR|FAULT).*$/m) ?? ['clean'])[0].trim())
} finally {
  restore()
}

/* THE DATABASE IS PUT BACK — asserted against the counts taken before the
   snapshot, not against the snapshot that did the restoring. A probe that
   leaves prose on a room page has changed the product, and the only thing that
   would notice is a census in a different suite. */
const CENSUS_AFTER = [
  sql('select count(*) from public.room_descriptions'),
  sql('select count(*) from public.change_log'),
  sql('select count(*) from public.pending_changes'),
].join('/')
ok(CENSUS_AFTER === CENSUS_BEFORE && rowsFor() === 0,
  'the database is restored — no prose, no queue row and no audit entry left behind',
  `descriptions/change_log/pending before ${CENSUS_BEFORE}, after ${CENSUS_AFTER}`)

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
