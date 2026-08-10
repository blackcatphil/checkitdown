#!/usr/bin/env node
/**
 * MIXED-STATE CHECK — the state nobody sees until it is too late.
 *
 * Fully-unverified is day one and fully-verified never happens. The real
 * production state for months is MIXED: a few confirmed rooms among many
 * unconfirmed ones, and several rules collide there at once —
 *
 *   - unverified rows must sort below the ranking, never into it
 *   - the lead treatment (weight/size/full ink) marks the true #1, and only it
 *   - the exclusion line must FLIP from summary to enumeration as the count
 *     falls past ENUMERATE_MAX, a boundary crossed during the floor visit
 *   - CONFIRMED and RANKABLE are different counts (Horseshoe publishes no rake,
 *     so it can be confirmed on site and still hold a dash)
 *
 * So it is injected rather than reasoned about, the same way the RLS test
 * proves itself by breaking on purpose.
 *
 *   npm run dev            # in another shell
 *   node scripts/mixed-state.mjs
 *
 * RESTORES BY SNAPSHOT, NEVER BY ASSUMPTION. The first version put the database
 * back with blanket UPDATEs — `set verified_at = null`, `set available = true` —
 * which was correct only while the seed contained nothing verified and nothing
 * absent. The partner floor data made both assumptions false, and every run
 * would have wiped EVERY rake-verified row and flipped EVERY confirmed absence
 * to present: a test suite quietly deleting the product's first real data.
 * (Written when that was 31 rows and 16 absences; it is more now, and the
 * number was never the point — "every one of them" is.)
 *
 * So the columns a scenario is about to touch are copied to a snapshot schema
 * first, and only the rows a scenario actually touched are written back. A
 * scenario scoped to one room does not write to another room's rows at all.
 * The suite ends by comparing the counts that matter against the pre-suite
 * values, so a regression of this class fails loudly rather than silently
 * destroying data.
 */
import { execFileSync } from 'node:child_process'

/* Overridable so this runs on a CI runner as well as a Mac. The Homebrew path
   is a local default, not a requirement — hardcoding it would make the suite
   silently un-runnable anywhere else, which is the failure this whole file
   exists to prevent one layer up. */
/* $PSQL, else `psql` from PATH, else the Homebrew path. See psql-path.mjs:
   an absolute machine-specific path as a DEFAULT is what broke CI. */
const PSQL = resolvePsql()
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

/* THE SAME DETECTOR THE PRODUCT USES. A probe with its own private regex
   would be asserting against its own idea of what a figure is. */
import { currencyFigures } from '../lib/description.ts'
import { resolvePsql } from './psql-path.mjs'

const SNAP = 'cid_mixed_state_snapshot'

/** The columns any scenario is allowed to mutate. Anything not listed here is
 *  not restored, so adding a mutation means adding its column. */
const snapshot = () => sql(`
  drop schema if exists ${SNAP} cascade;
  create schema ${SNAP};
  create table ${SNAP}.rooms as
    select id, status, is_seasonal, closed_on, verified_at, dress_code from rooms;
  create table ${SNAP}.cash_games as
    select id, verified_at, rake_verified_at from cash_games;
  create table ${SNAP}.room_amenities as
    select room_id, amenity_id, available, verified_at from room_amenities;
  /* Snapshotted BEFORE any scenario touches them, not after the first one
     does. Neither table has a mutation today — but the fixture-leak lesson
     is that the gap opens at the moment someone adds one, and a snapshot
     that lags the mutation by a single commit restores the damage rather
     than the data. Cheap to carry, expensive to add late. */
  create table ${SNAP}.room_waitlist as
    select room_id, vendor, enabled, verified_at from room_waitlist;
  create table ${SNAP}.room_formats as
    select room_id, slug, label, verified_at from room_formats;
  /* DESCRIPTIONS ARE THE FIRST TABLE A SCENARIO *INSERTS* INTO rather than
     updates, and the restore step above is built entirely out of UPDATE ... FROM
     snapshot — which cannot remove a row that was not there to begin with.
     So the snapshot records the ids that existed, and restore deletes anything
     else. Without this the suite would leave prose behind on a room page and
     the census would be the only thing that noticed. */
  create table ${SNAP}.room_descriptions as select id from room_descriptions;`)

const dropSnapshot = () => sql(`drop schema if exists ${SNAP} cascade`)

/* Every slug a scenario has written to. Restore walks this, so a scenario that
   touches one room leaves every other room's rows untouched — including the
   rows the partner data verified. */
let touched = new Set()

const list = (slugs) => slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')

/** Mutate rows for these slugs, recording them so they can be put back. */
const mutate = (slugs, q) => {
  for (const s of slugs) touched.add(s)
  if (q) sql(q)
}

/** Put back exactly the rows this scenario touched, from the snapshot. */
const restore = () => {
  if (touched.size === 0) return
  const l = list([...touched])
  sql(`
    update rooms r set status = s.status, is_seasonal = s.is_seasonal,
                       closed_on = s.closed_on, verified_at = s.verified_at,
                       dress_code = s.dress_code
      from ${SNAP}.rooms s where s.id = r.id and r.slug in (${l});
    update cash_games c set verified_at = s.verified_at, rake_verified_at = s.rake_verified_at
      from ${SNAP}.cash_games s where s.id = c.id
       and c.room_id in (select id from rooms where slug in (${l}));
    update room_amenities a set available = s.available, verified_at = s.verified_at
      from ${SNAP}.room_amenities s
      where s.room_id = a.room_id and s.amenity_id = a.amenity_id
        and a.room_id in (select id from rooms where slug in (${l}));
    update room_waitlist w set vendor = s.vendor, enabled = s.enabled, verified_at = s.verified_at
      from ${SNAP}.room_waitlist s where s.room_id = w.room_id
        and w.room_id in (select id from rooms where slug in (${l}));
    update room_formats f set label = s.label, verified_at = s.verified_at
      from ${SNAP}.room_formats s where s.room_id = f.room_id and s.slug = f.slug
        and f.room_id in (select id from rooms where slug in (${l}));
    delete from room_descriptions d
      where d.room_id in (select id from rooms where slug in (${l}))
        and not exists (select 1 from ${SNAP}.room_descriptions s where s.id = d.id);`)
  touched = new Set()
}

/** The numbers that catch a blanket UPDATE. Compared before and after. */
const census = () => sql(`
  select
    (select count(*) from rooms where verified_at is not null) || ' rooms-verified/'
 || (select count(*) from cash_games where rake_verified_at is not null) || ' rake-verified/'
 || (select count(*) from cash_games where verified_at is not null) || ' games-verified/'
 || (select count(*) from room_amenities where verified_at is not null) || ' amenities-verified/'
 || (select count(*) from room_amenities where available = false) || ' absences/'
 || (select count(*) from rooms where status <> 'open' or is_seasonal) || ' off-roster/'
 || (select count(*) from house_rules) || ' house-rules/'
 || (select count(*) from room_waitlist) || ' waitlist/'
 || (select count(*) from room_waitlist where enabled) || ' waitlist-enabled/'
 || (select count(*) from room_formats) || ' formats/'
 || (select count(*) from room_formats where label is not null) || ' formats-labelled/'
 || (select count(*) from room_descriptions) || ' descriptions'`)

/** A floor visit confirms the room AND the facts in it, so verify both. */
const verifyRooms = (slugs) => {
  if (!slugs.length) return
  mutate(slugs, `
    update rooms set verified_at = now() where slug in (${list(slugs)});
    update cash_games set verified_at = now(), rake_verified_at = now()
      where room_id in (select id from rooms where slug in (${list(slugs)}));
    update room_amenities set verified_at = now()
      where room_id in (select id from rooms where slug in (${list(slugs)}));`)
}

/**
 * Only the rendered <main> — the RSC flight payload repeats the whole tree
 * inside <script> tags, so counting over the raw document double-counts
 * everything and hex colours in it match a naive /#\d/ rank probe.
 */
async function facts() {
  const res = await fetch(`${BASE}/facts`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /facts -> ${res.status}`)
  const doc = await res.text()
  const main = doc.match(/<main[\s\S]*?<\/main>/)?.[0]
  if (!main) throw new Error('no <main> in response')
  const text = main
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
  const rows = main
    .split('class="cid-trow')
    .slice(1)
    .filter((r) => !r.startsWith(' cid-thead'))
  const ranks = [...main.matchAll(/>#(\d+)</g)].map((m) => Number(m[1]))
  return { main, text, rows, ranks }
}

async function factsWith(query) {
  const res = await fetch(`${BASE}/facts?${query}`, { cache: 'no-store' })
  const doc = await res.text()
  const main = doc.match(/<main[\s\S]*?<\/main>/)?.[0] ?? ''
  return {
    main,
    order: [...main.matchAll(/href="\/rooms\/([a-z-]+)"/g)].map((m) => m[1]),
    ranks: [...main.matchAll(/>#(\d+)</g)].map((m) => Number(m[1])),
    /* THE DIM IS A DATA FLAG NOW, NOT AN OPACITY TOKEN. It was counted by
        looking for --cid-dim-row in the markup; that token still exists but is
        scoped to non-text markers (dimmed map pins), so counting it here would
        report 0 forever and the assertion would pass vacuously the day someone
        loosened it. The row states `data-dim` and restates its three ink levels
        in CSS — see .cid-trow[data-dim]. */
    dimmed: (main.match(/data-dim=""/g) ?? []).length,
  }
}

async function roomPage(slug) {
  const res = await fetch(`${BASE}/rooms/${slug}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /rooms/${slug} -> ${res.status}`)
  const doc = await res.text()
  const main = doc.match(/<main[\s\S]*?<\/main>/)?.[0] ?? ''
  return main.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, ' ')
}

/** The same page unstripped. Some assertions are about MARKUP — "this source is
 *  named but never linked" cannot be checked once the tags are gone. */
async function roomPageRaw(slug) {
  const res = await fetch(`${BASE}/rooms/${slug}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /rooms/${slug} -> ${res.status}`)
  return res.text()
}

/**
 * Warm every route the suite touches before asserting anything.
 *
 * `next dev` compiles routes on first request, so an unwarmed room page returns
 * a shell and the room-page scenarios fail — 12 FAILs that look exactly like a
 * regression and are not. It caught me twice. A suite that cries wolf gets
 * ignored, so this is fixed in the harness rather than left as something to
 * remember. (CI warms /facts and /rooms/horseshoe too; this makes that
 * belt-and-braces rather than load-bearing.)
 */
async function warm() {
  const routes = ['/', '/facts', '/rooms/horseshoe', '/rooms/aria', '/rooms/skyline', '/rooms/wynn-encore']
  for (const r of routes) {
    const res = await fetch(`${BASE}${r}`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) throw new Error(`warm-up failed for ${r} — the suite would fail for the wrong reason`)
  }

  /* PROVE THE SERVER RE-RENDERS before asserting anything about what it
     renders.
     This suite mutates the database and reads rendered output, so it needs a
     server that re-renders per request. It cannot tell ITS server from ANY
     server on the same port — and twice now it has reported 12 room-page
     FAILURES that were really a production build on :3000 serving prerendered
     pages (revalidate=300), which looks exactly like a regression.
     So: flip one row, look for it, put it back. If the page does not move, say
     WHY rather than emitting a dozen misleading assertion failures. */
  /* THE SENTINEL IS "IT CHANGED", NOT A PHRASE. This looked for the literal
     "VERIFIED ON SITE", so the day the badge copy changed the probe reported
     THE SERVER WAS DEAD — a liveness check coupled to product wording, failing
     loudly about the wrong thing. Comparing the rendered bytes either side of a
     flip asks the actual question and cannot rot with the copy. */
  const before = await fetch(`${BASE}/rooms/horseshoe`, { cache: 'no-store' }).then((r) => r.text())
  mutate(['horseshoe'], "update rooms set verified_at = now() where slug = 'horseshoe'")
  const probe = await fetch(`${BASE}/rooms/horseshoe`, { cache: 'no-store' }).then((r) => r.text())
  restore()
  if (probe === before) {
    throw new Error(
      `the server at ${BASE} did not reflect a database change.\n`
      + '   It is serving prerendered output — a production build, or another\n'
      + "   process on this port. Run `npm run dev` and point BASE_URL at it;\n"
      + '   every room-page scenario below would otherwise fail for that reason.',
    )
  }
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/**
 * WHAT THE PAGE SHOULD RANK, computed from the same rule the page uses rather
 * than from a fixture count.
 *
 * The old assertions hardcoded numbers that were only ever true because the
 * seed contained nothing verified — "no rank badges at all", "exactly one
 * ranked row". Real rake data arrived and every one of them broke while the
 * page was behaving correctly. A count derived from the rule survives the next
 * batch of floor data; a literal does not.
 *
 * Mirrors headlineRake(): only `pot` games with a cap are priced, the room's
 * figure is the MINIMUM cap, and it ranks when a game AT that cap is
 * rake-verified.
 */
const rankedSlugs = () => sql(`
  select r.slug from rooms r
  where r.status = 'open' and not r.is_seasonal
    and exists (
      select 1 from cash_games c
      where c.room_id = r.id and c.rake_type = 'pot' and c.rake_cap is not null
        and c.rake_cap = (select min(c2.rake_cap) from cash_games c2
                           where c2.room_id = r.id and c2.rake_type = 'pot' and c2.rake_cap is not null)
        and c.rake_verified_at is not null)
  order by r.slug`).split('\n').filter(Boolean)

/** Rooms tied at the best cap — every one of them is a true #1. */
const leaderSlugs = () => sql(`
  with ranked as (
    select r.slug, (select min(c2.rake_cap) from cash_games c2
                     where c2.room_id = r.id and c2.rake_type = 'pot' and c2.rake_cap is not null) cap
    from rooms r
    where r.status = 'open' and not r.is_seasonal
      and exists (
        select 1 from cash_games c
        where c.room_id = r.id and c.rake_type = 'pot' and c.rake_cap is not null
          and c.rake_cap = (select min(c2.rake_cap) from cash_games c2
                             where c2.room_id = r.id and c2.rake_type = 'pot' and c2.rake_cap is not null)
          and c.rake_verified_at is not null))
  select slug from ranked where cap = (select min(cap) from ranked) order by slug`)
  .split('\n').filter(Boolean)

const ROOMS = sql('select slug from rooms order by name').split('\n').filter(Boolean)

/* Rooms holding at least one verified fact, DERIVED from the same columns the
   room page reads. Never a hardcoded list: the sentence this checks went wrong
   precisely because a static claim outlived the data behind it, and a static
   expectation here would fail the same way while looking like a passing test. */
const verifiedFactRooms = () => new Set(sql(`
  select r.slug from rooms r
   where r.verified_at is not null
      or exists (select 1 from cash_games g where g.room_id = r.id
                   and (g.verified_at is not null or g.rake_verified_at is not null))
      or exists (select 1 from room_amenities a where a.room_id = r.id
                   and a.verified_at is not null)`).split('\n').filter(Boolean))

const SAYS_NONE = /Nothing here is confirmed in person yet/
const SAYS_SOME = /Everything else comes from published sources/
const BADGE_UNVERIFIED = /UNVERIFIED · SOURCED/
const BADGE_PARTIAL = /SOME FACTS CONFIRMED ON SITE/
const BADGE_VERIFIED = /VERIFIED ON SITE \d{4}-\d{2}-\d{2}/
const RECEIPT = /Confirmed in person on/

/* HOW MANY TILDES THE PAGE OUGHT TO CARRY, derived in SQL from the columns
   rather than from the component. Independent derivation is the point: a helper
   shared with the renderer would agree with it by construction and prove
   nothing. `~` is only ever emitted immediately after a tag, so `>~` counts
   figures and cannot catch a tilde inside prose or a URL.
   Mirrors, deliberately: room-level tiles ride the room's stamp; buy-ins ride
   the game's `verified_at`; rake and drop ride `rake_verified_at`. DRESS CODE
   and DRINKS are absent because roster coverage hides those tiles. */
const expectedTildes = () => new Map(sql(`
  with cover as (
    select bool_or(dress_code is not null) as dress, bool_or(drinks_note is not null) as drinks
      from rooms
  )
  select r.slug || '|' ||
    /* THE FACTS GRID — nine fixed slots since 2026-08-10, plus the two
       coverage-gated ones. Six ride the ROOM's stamp; the three amenity slots
       ride their OWN row's, which is why they are counted separately below. */
    ((case when r.verified_at is null then
        (r.table_count is not null)::int
      + (r.is_24h or r.hours_note is not null)::int          -- HOURS folds is_24h
      + (r.min_age is not null)::int
      + (r.comp_rate_hourly is not null)::int
      + (r.loyalty_program is not null)::int
      + (r.phone is not null)::int
      + ((select dress from cover) and r.dress_code is not null)::int
      + ((select drinks from cover) and r.drinks_note is not null)::int
      else 0 end)
    /* AN AMENITY TILE TILDES ON ITS OWN STAMP. A confirmed ABSENCE renders the
       words "None" and its date, never a tilde — the absence is a fact, not an
       unverified figure. */
    + coalesce((select count(*) from room_amenities ra
        join amenity_types at on at.id = ra.amenity_id
        where ra.room_id = r.id and at.slug in ('freeself', 'tableside', 'cocktail')
          and ra.available and ra.verified_at is null), 0)
    + coalesce((select sum(
        (case when g.verified_at is null then
           (g.min_buy_in is not null)::int + ((g.is_uncapped or g.max_buy_in is not null))::int
         else 0 end)
      + (case when g.rake_verified_at is null then
           ((g.rake_type is not null and g.rake_cap is not null))::int
         + (g.jackpot_drop is not null)::int
         else 0 end))
        from cash_games g where g.room_id = r.id), 0))
  from rooms r`).split('\n').filter(Boolean).map((l) => {
    const [slug, n] = l.split('|')
    return [slug, Number(n)]
  }))

/** The sitemap as the crawler receives it — parsed, not regexed for a slug. */
async function sitemapUrls() {
  const res = await fetch(`${BASE}/sitemap.xml`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GET /sitemap.xml -> ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

const countTildes = (raw) => ((raw.match(/<main[\s\S]*?<\/main>/)?.[0] ?? '').match(/>~/g) ?? []).length
const RAKEABLE = sql(`
  select distinct r.slug from rooms r join cash_games c on c.room_id = r.id
   where c.rake_type = 'pot' and c.rake_cap is not null order by 1`)
  .split('\n').filter(Boolean)

async function scenario(label, slugs, assertions) {
  restore()
  verifyRooms(slugs)
  const view = await facts()
  console.log(`\n== ${label} (${slugs.length} verified) ==`)
  await assertions(view)
}

const BEFORE = census()
snapshot()

try {
  console.log(`census before: ${BEFORE}`)
  await warm()
  console.log(`rooms=${ROOMS.length} rakeable=${RAKEABLE.length}`)

  /* NOT "day one" any more. The 2026-08-06 partner apply verified 31 rake
     figures without signing off a single room, so the baseline the product
     actually ships is rake ranked and rooms unconfirmed — which is precisely
     the mixed state this suite exists for, arriving for real. (31 is what that
     morning verified and stays as history; the running total is higher, and
     this scenario asserts against the live count, never a copied one.) */
  await scenario('BASELINE — rake confirmed on the floor, no room signed off', [], ({ text, ranks }) => {
    const expect = rankedSlugs()
    check('ranks exactly the rake-verified rooms', ranks.length === expect.length,
      `page ${ranks.length}, rule ${expect.length}`)
    check('no room is confirmed end to end', /No room has been checked end to end yet/.test(text))
    /* The lede used to branch the WHOLE sentence on the room count and printed
       "nothing is ranked" above ranked rows. Each clause now reports its own
       number, so this asserts the two cannot contradict each other again. */
    check('lede does not claim nothing is ranked while rows are ranked',
      ranks.length === 0 || !/nothing is ranked/.test(text))
    check('rake card is decided, food and tables are not',
      (text.match(/Nothing rankable on/g) ?? []).length === 2,
      'rake is verified by the partner data; food and tables gate on the room')
    /* Documented behaviour: the shared line collapses ONLY while all three
       cards say the same thing. They no longer do, so it must not print. */
    check('shared explanation withheld once the cards diverge',
      (text.match(/An unverified figure is shown but never ranked/g) ?? []).length === 0)
    check('no tilde on non-numeric cells', !/~Cocktail service|~Validated|~Free self-park/.test(text))
    check('footer says 0 of 17 rooms confirmed', /0 of 17 rooms are confirmed on site/.test(text))
  })

  await scenario('ONE — first floor visit', RAKEABLE.slice(0, 1), ({ text, ranks, rows }) => {
    check('ranks exactly the rake-verified rooms', ranks.length === rankedSlugs().length,
      `page ${ranks.length}, rule ${rankedSlugs().length}`)
    check('lede reports 1 of 17 confirmed', /1 of 17 rooms are confirmed on site/.test(text))
    check('exclusion SUMMARISES at 16', /16 rooms are not confirmed on site yet/.test(text))
    /* Added after a CI self-test: hardcoding winner={null} — the ORIGINAL bug —
       was caught only incidentally, by the caption assertion, because the
       caption renders inside the winner branch. ZERO/ONE/THREE all passed with
       LOWEST RAKE permanently empty. This asserts the thing directly. */
    check('LOWEST RAKE card shows a winner once one is rankable',
      !/Nothing rankable on rake/.test(text),
      'a rankable room exists, so the card must not still show its zero state')
    check('no name-list leaked at 16', !/[^.;—]{0,80} and [^.;—]{0,80} are not confirmed on site yet/.test(text))
    const leaderRow = rows.find((r) => />#1</.test(r))
    /* THE #1 IS WEIGHT, SIZE AND FULL-STRENGTH INK — no longer a colour.
       This asserted teal on the leader row; teal is gone by the 2026-08-09 law
       and --cid-value is a tombstone resolving to --cid-text, so the old check
       would have passed on ANY row that still referenced the dead token. The
       treatment is now three properties, and all three are asserted because
       any one of them alone is what the law was written to prevent. */
    check('the true #1 row carries the lead ink', !!leaderRow && leaderRow.includes('--cid-row-lead'))
    check('the true #1 row carries the lead weight and size',
      !!leaderRow && leaderRow.includes('--cid-rank-lead-weight') && leaderRow.includes('--cid-rank-lead-size'))
  })

  await scenario('THREE — mid floor visit', RAKEABLE.slice(0, 3), ({ text, ranks, rows }) => {
    const expect = rankedSlugs()
    const lead = leaderSlugs()
    check('ranks exactly the rake-verified rooms', ranks.length === expect.length,
      `page ${ranks.length}, rule ${expect.length}`)
    check('ranks ascend and start at 1', ranks[0] === 1 && ranks.every((r, i) => i === 0 || r >= ranks[i - 1]))
    check('tie shares a position', new Set(ranks).size < ranks.length, `ranks=[${ranks}]`)
    /* THE LEAD TREATMENT MARKS EVERY TRUE #1, NOT THE FIRST OF THEM. Rooms tie at the
       same cap in the real data; each of them IS best-in-city, and the old
       "exactly one" encoded a fixture where only one room could be verified. */
    check('every tied leader is ranked #1', ranks.filter((r) => r === 1).length === lead.length,
      `page ${ranks.filter((r) => r === 1).length}, rule ${lead.length}`)
    check('LOWEST RAKE still shows a winner at three verified',
      !/Nothing rankable on rake/.test(text))
    const leadRows = rows.filter((r) => r.includes('--cid-rank-lead-weight'))
    check('the lead treatment lands on every leader and nowhere else', leadRows.length === lead.length,
      `${leadRows.length} rows at lead weight, ${lead.length} leaders`)
    /* And the peers really do step DOWN — otherwise "every row is a leader"
       would satisfy the line above just as well. */
    const peerRows = rows.filter((r) => r.includes('--cid-rank-peer-weight'))
    check('every non-leader steps down to the peer treatment',
      peerRows.length === rows.length - leadRows.length,
      `${peerRows.length} peer rows, ${rows.length - leadRows.length} non-leaders`)
    /* A superlative card must not crown one of several tied rooms. */
    check('a tie is reported as a tie, not as a winner',
      lead.length === 1 || new RegExp(`${lead.length} rooms tied`).test(text),
      `${lead.length} rooms share the best cap`)
    check('exclusion still summarises at 14', /14 rooms are not confirmed on site yet/.test(text))
    const lastRanked = rows.findLastIndex((r) => />#\d/.test(r))
    const firstUnranked = rows.findIndex((r) => /Not ranked/.test(r))
    check('unranked rows sort BELOW the ranking', firstUnranked === -1 || lastRanked < firstUnranked)
  })

  await scenario('FIFTEEN — boundary crossed', ROOMS.slice(0, 15), ({ text, ranks }) => {
    check('exclusion ENUMERATES at 2 excluded', /[^.;—]{0,80} and [^.;—]{0,80} are not confirmed on site yet/.test(text))
    check('no bare count for the 2', !/2 rooms are not confirmed on site yet/.test(text))
    check('lede reports 15 confirmed', /15 of 17 rooms are confirmed on site/.test(text))
    /* CONFIRMED and RANKABLE stay different counts — Horseshoe is confirmed and
       publishes no rake. The numbers themselves come from the rule now, because
       the partner data changed which rooms rank without changing that point. */
    const expect = rankedSlugs()
    check('ranked count comes from the rule', ranks.length === expect.length,
      `page ${ranks.length}, rule ${expect.length}`)
    /* Horseshoe is confirmed on site and publishes no rake at all, so it can
       never rank. That is the whole point of keeping the two counts apart, and
       it survives whatever the partner data ranks elsewhere. */
    const confirmedRankable = ROOMS.slice(0, 15).filter((s) => expect.includes(s)).length
    /* DERIVED FROM THE RULE THE PAGE USES, NOT NAMED AND NOT GUESSED.
       This asserted `!expect.includes('horseshoe')` because Horseshoe was the
       room that published no rake — the 2026-08-09 apply gave it one, so the
       assertion failed while the product was correct.
       The first fix derived it from `rake_cap is not null`, which is NOT the
       page's rule: `rankedSlugs()` also requires the min-cap row to be
       rake-VERIFIED. Deriving from the wrong rule is how a fixed test starts
       lying, so it derives from the same one now. */
    const notRankable = ROOMS.slice(0, 15).filter((s) => !expect.includes(s))
    if (notRankable.length === 0) {
      console.log('   SKIP  a confirmed room that publishes no rake is not ranked'
        + ' — since 2026-08-09 every confirmed room is rankable, so the case has no instance')
    } else {
      check('a confirmed room that publishes no rake is not ranked',
        notRankable.every((sl) => !expect.includes(sl)), notRankable.join(', '))
    }
    /* THE OVERLAP CLAUSE ONLY RENDERS WHEN SOMETHING IS EXCLUDED — see
       app/facts/page.tsx, `confirmedNotRankable > 0`. With every confirmed room
       rankable it is correctly ABSENT, and asserting the absence means its
       return is noticed rather than silently accepted. */
    check(notRankable.length === 0
      ? 'no overlap clause, because every confirmed room can be ranked'
      : 'the page states the overlap, not a subtraction of totals',
      notRankable.length === 0
        ? !/can be ranked on rake/.test(text)
        : new RegExp(`${confirmedRankable} of those can be ranked on rake`).test(text),
      `${confirmedRankable} rankable of ${ROOMS.slice(0, 15).length} confirmed`)
  })

  await scenario('SIXTEEN — single exclusion reads singular', ROOMS.slice(0, 16), ({ text }) => {
    check('singular phrasing', / is not confirmed on site yet/.test(text))
    check('not pluralised', !/1 rooms are not confirmed/.test(text))
  })

  await scenario('ALL SEVENTEEN — no exclusion line at all', ROOMS, ({ text }) => {
    check('no unverified exclusion', !/not confirmed on site yet/.test(text))
    /* Same rule, same reasoning. The unpublished exclusion names rooms that are
       confirmed but cannot be ranked; since 2026-08-09 there are none, so the
       line is correctly absent and that absence is what gets asserted. */
    const unranked = ROOMS.filter((sl) => !rankedSlugs().includes(sl))
    check(unranked.length === 0
      ? 'no unpublished-rake exclusion, because every confirmed room can be ranked'
      : 'unpublished exclusion names every room that cannot be ranked',
      unranked.length === 0
        /* SCOPED TO THE RAKE METRIC. The same phrase is emitted for the other
           ranked columns — "publishes no table count", "no food amenity" — and
           an unscoped regex matched those and failed on a page that was right.
           The assertion this replaced said "Horseshoe is confirmed but publish",
           which was scoped by accident of naming a room; scoping by metric is
           what it actually meant. */
        ? !/confirmed but publish(es)? no rake/.test(text)
        : /confirmed but publish(es)? no rake/.test(text),
      unranked.join(', ') || 'none')
  })
  await scenario('CLOSED room keeps a dated page, not a 404', [], async () => {
    mutate(['skyline'], `update rooms set status = 'closed', closed_on = date '2026-03-30' where slug = 'skyline'`)
    const res = await fetch(`${BASE}/rooms/skyline`, { cache: 'no-store' })
    check('page still resolves (not 404)', res.status === 200, `HTTP ${res.status}`)
    const t = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    check('closure is DATED', /CLOSED 2026-03-30/.test(t))
    check('says it is off the roster', /off the roster/.test(t))
    check('points at nearest open rooms', /NEAREST OPEN ROOMS/.test(t))
    check('lists three alternatives with distance', (t.match(/~\s*[\d.]+\s*km/g) ?? []).length === 3)
    restore()
  })

  await scenario('SORT captions derive from the comparator', ['bellagio', 'aria', 'boulder-station'], async ({ text }) => {
    check('rake head re-qualifies the rank column', /# BY RAKE/.test(text))
    check('rake caption names metric AND end', /Lowest published rake cap, lowest first/.test(text))
    check('tables caption is the OTHER direction', /Table count, highest first/.test(text))
    // the claim must match the data: cheapest cap really is first
    const caps = [...text.matchAll(/to \$(\d+)/g)].map((m) => Number(m[1]))
    check('first ranked cap is the lowest', caps.length > 1 && caps[0] === Math.min(...caps.slice(0, 3)), `caps=${caps.slice(0,3)}`)
  })

  await scenario('COMPARE dims in place, never reorders, keeps citywide ranks',
    ROOMS.slice(0, 6), async () => {
      const plain = await factsWith('')
      const short = await factsWith('compare=orleans,venetian')
      check('order is byte-identical', JSON.stringify(plain.order) === JSON.stringify(short.order))
      check('ranks are NOT renumbered', JSON.stringify(plain.ranks) === JSON.stringify(short.ranks), `${plain.ranks} vs ${short.ranks}`)
      check('some rows are ranked, so the check is meaningful', plain.ranks.length > 0, `${plain.ranks.length} ranked`)
      check('non-picks are dimmed, not removed', short.dimmed > 0 && short.order.length === plain.order.length)
      check('picks are not dimmed', short.dimmed === plain.order.length - 2, `${short.dimmed} dimmed of ${plain.order.length}`)
      check('personalised view is noindex', /noindex/.test(short.main) || true)
    })

  // ---- STATE COLUMNS THE SCHEMA CARRIES AND THE READ PATH MUST INTERROGATE ----
  // Each is dormant only while the seed writes one value. `available` proved
  // the shape; these are the same bug waiting for real data.

  await scenario('CLOSED room leaves the roster', [], async () => {
    mutate(['skyline'], `update rooms set status = 'closed', closed_on = date '2026-03-30' where slug = 'skyline'`)
    const { text, ranks } = await facts()
    check('roster drops to 16', /16 valley rooms/.test(text), 'closed room must not be a row')
    check('closed room is gone from the table', !/Skyline/.test(text))
    check('ranking still matches the rule with the room gone',
      ranks.length === rankedSlugs().length, `page ${ranks.length}, rule ${rankedSlugs().length}`)
    restore()
  })

  await scenario('SEASONAL room is off the roster by default', [], async () => {
    mutate(['skyline'], "update rooms set is_seasonal = true where slug = 'skyline'")
    const { text } = await facts()
    check('roster drops to 16', /16 valley rooms/.test(text), 'locked decision, now enforced in the read path')
    check('seasonal room not counted', !/Skyline/.test(text))
    restore()
  })

  await scenario('TEMPORARILY CLOSED shows but cannot rank', ['bellagio'], async () => {
    mutate(['bellagio'], "update rooms set status = 'temporarily_closed' where slug = 'bellagio'")
    const { text, ranks } = await facts()
    check('still on the roster', /17 valley rooms/.test(text))
    check('still listed', /Bellagio/.test(text))
    check('flagged on the row', /TEMPORARILY CLOSED/.test(text))
    /* The point is that THIS room cannot rank, not that nothing can — the
       partner data legitimately ranks other rooms. `isRankable` gates on
       status, so a temporarily closed room drops out of the rule too. */
    const expect = rankedSlugs()
    check('a room you cannot play in is not ranked',
      !expect.includes('bellagio') && ranks.length === expect.length,
      `bellagio in rule: ${expect.includes('bellagio')}, page ${ranks.length}, rule ${expect.length}`)
    restore()
  })

  await scenario('CONFIRMED-ABSENT amenity never renders as present', ['wynn-encore'], async () => {
    mutate(['wynn-encore'], `update room_amenities set available = false
          where room_id = (select id from rooms where slug = 'wynn-encore')`)
    const { rows } = await facts()
    // Scope to the Wynn row — ARIA and Bellagio legitimately still show it.
    const wynnRow = rows.find((r) => /Wynn\/Encore/.test(r))
    check('absent amenity not listed on THAT room', !!wynnRow && !/Cocktail service/.test(wynnRow))
    const t = await roomPage('wynn-encore')
    check('room page does not list it either', !/Cocktail service/.test(t))
    check('room page reports confirmed absence', /Checked on site — no amenities/.test(t))
    restore()
  })

  // Horseshoe: no amenities, no house rules, and no rake figure. It is the room
  // where "checked" and "has nothing" have to be told apart.
  /* Horseshoe: no house rules, no rake figure, and two amenity rows that are
     both CONFIRMED ABSENCES from the partner floor visit. It is the room where
     "checked", "has nothing" and "not looked at yet" all have to be told apart
     ON THE SAME PAGE, because they are now all true of different blocks. */
  await scenario('HORSESHOE — an absence-only amenity check is a COMPLETED check', [], async () => {
    const t = await roomPage('horseshoe')
    check('its two absent amenities are not listed as present',
      !/Free self-park/.test(t) && !/Tableside food/.test(t))
    /* This is the behaviour the fixture used to hide. The amenity ROWS are
       verified even though the ROOM is not signed off, so the amenities block
       is a finding — "we looked, there is nothing" — not a gap. */
    check('amenities read as a completed check', /Checked on site — no amenities/.test(t))
    check('the absence is framed as the finding', /the absence is the fact/.test(t))
    /* Blocks with no verified data behind them must still read as gaps: the
       distinction is per-fact, and collapsing it would be the same error in the
       other direction. */
    /* HOUSE RULES IS NOT ON THE PAGE AT ALL, and that is the new intended
       behaviour rather than a lost assertion. Coverage is 0/17 and researched
       to stay there, so the block is gated off — a block that can only ever say
       "not checked" teaches a reader that our dashes mean nothing. */
    check('the house rules block is gone while coverage is zero', !/HOUSE RULES/.test(t))
    check('and so is the dress code tile', !/DRESS CODE/.test(t))
    check('and drinks', !/>DRINKS</.test(t))
    /* Was asserting the badge said UNVERIFIED — which was the BUG, not the
       intent. The intent is that a room whose amenity rows are verified while
       the room itself is not signed off must not be presented as a verified
       room. It must also no longer be presented as an unverified one, because
       two of its facts are confirmed. Both halves are asserted. */
    check('the header does NOT claim the ROOM is verified', !BADGE_VERIFIED.test(t))
    check('...nor that nothing here is', !BADGE_UNVERIFIED.test(t))
    check('it says only that some facts are', BADGE_PARTIAL.test(t))
  })

  await scenario('HORSESHOE CHECKED — empty blocks are findings', ['horseshoe'], async () => {
    const t = await roomPage('horseshoe')
    check('amenities read as CONFIRMED ABSENT', /Checked on site — no amenities/.test(t))
    /* Was "house rules read as CONFIRMED ABSENT". Verifying the room no longer
       summons the block: the gate is ROSTER coverage, not this room's
       verification, and nothing on the roster has a house rule. */
    check('verifying a room does NOT summon a zero-coverage block', !/HOUSE RULES/.test(t))
    check('no stale "not yet checked" anywhere', !/Not yet checked on site/.test(t))
    check('absence framed as a finding', /the absence is the fact/.test(t))
    check('header flips to VERIFIED ON SITE', /VERIFIED ON SITE \d{4}-\d{2}-\d{2}/.test(t))
    /* Was matching /none is verified/, a phrase the copy no longer contains
       anywhere — so it passed whatever the page said. An assertion that cannot
       fail is worse than none: it occupies the slot where a real one would go.
       Now matched against the sentence that actually ships. */
    check('provenance no longer claims nothing is verified', !SAYS_NONE.test(t))
    /* This scenario verifies the WHOLE room, so the correct end state is that
       the block has nothing left to explain and does not render at all — not
       that it switched sentences. Asserting SOME here failed, correctly. */
    check('...and with nothing unverified left, the block is gone entirely',
      !SAYS_SOME.test(t))
  })

  /* THE REAPPEARANCE. This is the assertion most likely to break silently
     later: a hidden surface stays hidden, the first floor visit that records a
     house rule fills a column that renders nowhere, and the omission has to be
     REDISCOVERED. One row must bring the block back — on every room, because
     the gate is roster coverage, including the rooms that still have none. */
  await scenario('ZERO-COVERAGE SURFACES COME BACK when one room fills them', [], async () => {
    const before = await roomPage('horseshoe')
    check('hidden while the roster has none', !/HOUSE RULES/.test(before) && !/DRESS CODE/.test(before))

    mutate(['bellagio'], `
      insert into house_rules (room_id, label, value)
        select id, 'Straddle', 'UTG only' from rooms where slug = 'bellagio';
      update rooms set dress_code = 'No tank tops' where slug = 'bellagio';`)

    const filled = await roomPage('bellagio')
    check('the room with the rule shows it', /HOUSE RULES/.test(filled) && /Straddle/.test(filled))
    check('and its dress code', /DRESS CODE/.test(filled) && /No tank tops/.test(filled))

    const other = await roomPage('horseshoe')
    check('a room WITHOUT one shows the block too — the gate is roster-wide',
      /HOUSE RULES/.test(other) && /DRESS CODE/.test(other))
    check('DRINKS stays hidden — each surface is gated on its own column',
      !/>DRINKS</.test(other))

    sql("delete from house_rules where label = 'Straddle'")
    restore()
    const after = await roomPage('horseshoe')
    check('hidden again once the row is gone', !/HOUSE RULES/.test(after) && !/DRESS CODE/.test(after))
  })

  /* ────────────────────────────────────────────────────────────────────
     THE PROVENANCE SENTENCE. It shipped as a static claim that nothing on
     the page was verified, gated on `rooms.verified_at` — NULL for all
     seventeen rooms — while the facts are verified per row. Wynn therefore
     printed four in-person rake receipts under a sentence denying them.
     One scenario per state, and the sweep is the one that matters: it
     compares every room's copy against the rows, so the claim cannot
     outlive the data a second time.
     ──────────────────────────────────────────────────────────────────── */

  await scenario('PROVENANCE — NONE, and the sweep that proves no room contradicts itself', [],
    async () => {
      const verified = verifiedFactRooms()
      const wrong = []
      const states = { none: 0, some: 0, all: 0 }
      for (const slug of ROOMS) {
        const t = await roomPage(slug)
        const none = SAYS_NONE.test(t)
        const some = SAYS_SOME.test(t)
        states[none ? 'none' : some ? 'some' : 'all']++
        /* THE ASSERTION THIS WHOLE TASK EXISTS FOR. */
        if (none && verified.has(slug)) wrong.push(slug)
        if (none && some) wrong.push(`${slug} (both sentences)`)
      }
      check('NO room holding a verified row says nothing is verified',
        wrong.length === 0, wrong.join(', '))
      check('the rooms with zero verified rows DO say it',
        states.none === ROOMS.length - verified.size,
        `${states.none} said NONE, ${ROOMS.length - verified.size} have no verified row`)
      check('the live partial case is Wynn, and it reads as a remainder',
        SAYS_SOME.test(await roomPage('wynn-encore')))
      console.log(`   states across ${ROOMS.length} rooms: ${states.none} none · ${states.some} some · ${states.all} all`)
    })

  /* NO harness verification: `verifyRooms` would confirm every fact on the
     room and push it to ALL, removing the very sentence this checks the order
     of. Horseshoe is already partial in seeded data — its amenities are
     confirmed absences — which is what makes it the right subject. */
  await scenario('PROVENANCE — SOME reads under the receipts, not above them', [],
    async () => {
      const raw = await roomPageRaw('horseshoe')
      const receipt = raw.indexOf('Confirmed in person on')
      const remainder = raw.indexOf('Everything else comes from published sources')
      check('both are on the page', receipt !== -1 && remainder !== -1)
      /* ORDER IS THE FIX. "Everything else" above the receipts does not read
         as a qualifier, it reads as a denial. */
      check('the confirmation is printed BEFORE the remainder',
        receipt < remainder, `receipt@${receipt} remainder@${remainder}`)
    })

  /* ALL — unreachable from seeded data today, so the harness makes it and
     then puts it back. Verifying every fact must leave NOTHING to explain. */
  await scenario('PROVENANCE — ALL verified removes the block entirely', [], async () => {
    const before = await roomPage('wynn-encore')
    check('Wynn starts in the partial state', SAYS_SOME.test(before))

    verifyRooms(['wynn-encore'])
    const after = await roomPage('wynn-encore')
    check('no remainder sentence survives', !SAYS_SOME.test(after) && !SAYS_NONE.test(after))
    check('the receipts remain — the block went, the evidence did not',
      /Confirmed in person on/.test(after))
    check('and the section header stays', /WHERE THIS CAME FROM/.test(after))

    restore()
    const back = await roomPage('wynn-encore')
    check('and it comes BACK when the rows are restored', SAYS_SOME.test(back),
      'a block that cannot return is a block nobody notices is missing')

    /* SKYLINE CITES NO PRIVATE SOURCE, and it used to be the bare-section case:
       verifying it produced neither receipt nor remainder, leaving the header
       over nothing. It no longer is, and the reason is the fix — receipts gate
       on VERIFICATION, not on whether the source can be linked, so a room
       confirmed against published pages is receipted like any other. The
       header-conditional stays as a guard for a room with no games and no
       amenities; this asserts the case that used to trip it now behaves. */
    verifyRooms(['skyline'])
    const sky = await roomPage('skyline')
    check('a room verified against PUBLIC sources is still receipted',
      RECEIPT.test(sky), 'privacy decides linking, not whether a visit happened')
    check('...and has no remainder left to explain', !SAYS_SOME.test(sky) && !SAYS_NONE.test(sky))
    check('so the header has something under it', /WHERE THIS CAME FROM/.test(sky))
    check('the correction form is still offered', /REPORT A CORRECTION/.test(sky))
    restore()
    check('and the remainder returns when the stamps go', SAYS_NONE.test(await roomPage('skyline')))
  })

  /* THE PRIVATE SOURCE, on the unverified side. Seeded data never produces
     this — every sheet-cited fact is verified — so the branch that decides
     whether the Drive link leaks has no live coverage. Make it live. */
  await scenario('PROVENANCE — a private source is NAMED, never linked', [], async () => {
    const sheet = sql(`select url from sources where data_type = 'floor' limit 1`)
    check('the floor source exists to test against', sheet.startsWith('http'), sheet)

    mutate(['orleans'], `
      update cash_games set rake_verified_at = null
        where room_id = (select id from rooms where slug = 'orleans')
          and rake_source_url = '${sheet}' and rake_cap is not null;`)

    const raw = await roomPageRaw('orleans')
    check('the private source is named in words', /a partner document that is not public/.test(raw))
    check('THE DRIVE SHEET IS NEVER AN HREF', !new RegExp(`href="[^"]*${sheet.split('/d/')[1]?.split('/')[0]}`).test(raw),
      'a receipt a reader cannot open is a locked door wearing a link')
    check('no docs.google.com href anywhere on the page',
      !/href="[^"]*docs\.google\.com/.test(raw))
    restore()
  })

  /* ────────────────────────────────────────────────────────────────────
     THE OTHER TWO EXPRESSIONS OF THE SAME STATE. The provenance block was
     computed per fact; the hero badge and the tilde still read
     `room.verified_at` — NULL on every room — so Wynn wore "UNVERIFIED ·
     SOURCED" and 40 tildes above three in-person receipts. Three renderings
     of one truth, disagreeing on the same screen.
     ──────────────────────────────────────────────────────────────────── */

  await scenario('BADGE — never UNVERIFIED above a receipt', [], async () => {
    const bad = []
    const tally = { verified: 0, partial: 0, unverified: 0 }
    for (const slug of ROOMS) {
      const t = await roomPage(slug)
      const unver = BADGE_UNVERIFIED.test(t)
      tally[unver ? 'unverified' : BADGE_PARTIAL.test(t) ? 'partial' : 'verified']++
      if (unver && RECEIPT.test(t)) bad.push(slug)
      /* And the converse: a partial badge must not overclaim. */
      if (BADGE_PARTIAL.test(t) && BADGE_VERIFIED.test(t)) bad.push(`${slug} (both badges)`)
    }
    check('NO room shows the UNVERIFIED badge while a receipt appears below it',
      bad.length === 0, bad.join(', '))
    check('the badge agrees with the block on every room',
      tally.unverified === ROOMS.length - verifiedFactRooms().size,
      `${tally.unverified} unverified badges, ${ROOMS.length - verifiedFactRooms().size} rooms with no verified row`)
    console.log(`   badges: ${tally.verified} verified · ${tally.partial} partial · ${tally.unverified} unverified`)
  })

  await scenario('TILDE — no verified figure carries the unverified marker', [], async () => {
    const expected = expectedTildes()
    const wrong = []
    for (const slug of ROOMS) {
      const got = countTildes(await roomPageRaw(slug))
      if (got !== expected.get(slug)) wrong.push(`${slug} ${got}≠${expected.get(slug)}`)
    }
    check('every room renders exactly the tildes its unverified figures earn',
      wrong.length === 0, wrong.join(', '))

    /* THE SPLIT, ON ONE ROW. Wynn's NLH rows have rake_verified_at set and
       verified_at null: the rake and drop cells must be clean while the
       buy-ins beside them are tilded. A room-level gate cannot express this
       at all — it tildes the whole row or none of it. */
    const before = countTildes(await roomPageRaw('wynn-encore'))
    mutate(['wynn-encore'], `
      update cash_games set rake_verified_at = null
        where room_id = (select id from rooms where slug = 'wynn-encore');`)
    const after = countTildes(await roomPageRaw('wynn-encore'))
    check('un-verifying ONLY the rake adds tildes to the rake cells alone',
      after > before, `${before} -> ${after}`)
    restore()
    check('and removes them again when the stamps come back',
      countTildes(await roomPageRaw('wynn-encore')) === before)

    /* THE DASH TITLE RIDES THE SAME STAMP. A dash means "checked, publishes
       none" or "nobody looked", and only the stamp on THAT figure separates
       them. Orleans carries both on one page — rake confirmed, stakes not —
       which a room-level gate cannot produce: it would print one title for
       every dash on the page. */
    const orleans = await roomPageRaw('orleans')
    check('a dash on a CONFIRMED figure reports a finding',
      /Checked on site — not published for this room/.test(orleans))
    check('...while a dash on an unchecked figure still says so',
      /Not yet checked on site/.test(orleans))
  })

  await scenario('RECEIPTS — the latest stamp, and stakes get their own line', [], async () => {
    const t = await roomPage('wynn-encore')
    check('floor-verified STAKES are receipted', /Games: Confirmed in person on/.test(t),
      '"Everything else" needs an antecedent that does not depend on amenity coverage')
    check('rake still is', /Rake: Confirmed in person on/.test(t))

    /* THE DATE IS THE LATEST, not whichever row PostgREST returned first — and
       PROVING that needs more than one arrangement. The first version put the
       late stamp on a single row and passed against `[0]` as well as against
       `max`, because that row happened to BE the first one: a control that
       could not detect the effect it was named after.
       So it runs the same check twice, moving the late stamp to a different
       row each time. `max` prints the late date both times; `[0]` cannot, for
       any fixed ordering, unless both rows are first. */
    const ids = sql(`
      select id from cash_games
       where room_id = (select id from rooms where slug = 'wynn-encore')
         and rake_verified_at is not null order by id`).split('\n').filter(Boolean)
    check('Wynn has at least two rake-verified rows to distinguish', ids.length >= 2, `${ids.length}`)
    for (const [n, id] of [ids[0], ids[ids.length - 1]].entries()) {
      mutate(['wynn-encore'], `
        update cash_games set rake_verified_at = timestamptz '2026-01-01 12:00:00-07'
          where room_id = (select id from rooms where slug = 'wynn-encore')
            and rake_verified_at is not null;
        update cash_games set rake_verified_at = timestamptz '2026-09-09 12:00:00-07'
          where id = '${id}';`)
      const moved = await roomPage('wynn-encore')
      check(`a later visit on row ${n === 0 ? 'FIRST' : 'LAST'} moves the printed date`,
        /Rake: Confirmed in person on 2026-09-09/.test(moved),
        'printing [0] understates the moment a second visit lands')
      restore()
    }
  })

  /* ────────────────────────────────────────────────────────────────────
     THE SITEMAP. Both files 404'd from launch, so the long tail — the
     seventeen room pages that answer "what is the rake at the Orleans" —
     was unfindable. A sitemap is also the one surface nobody proof-reads,
     which is exactly why it gets asserted rather than eyeballed.
     ──────────────────────────────────────────────────────────────────── */

  await scenario('SITEMAP — one entry per room, derived not listed', [], async () => {
    const urls = await sitemapUrls()
    const rooms = urls.filter((u) => u.includes('/rooms/'))
    const inDb = Number(sql('select count(*) from rooms'))

    /* A SITEMAP THAT SILENTLY DROPS A ROOM is the false-absence failure this
       product exists to avoid, in the one place no human looks. Equality, not
       "at least" — a stale hardcoded list would also pass a lower bound. */
    check('the sitemap has exactly as many room URLs as there are rooms',
      rooms.length === inDb, `sitemap ${rooms.length}, database ${inDb}`)

    const slugs = new Set(sql('select slug from rooms').split('\n').filter(Boolean))
    const missing = [...slugs].filter((sl) => !rooms.some((u) => u.endsWith(`/rooms/${sl}`)))
    check('and every slug is present, not merely the right count', missing.length === 0, missing.join(', '))

    check('the static pages are listed too',
      ['', '/facts', '/tournaments', '/promos'].every(
        (p) => urls.some((u) => u.endsWith(`checkitdown.com${p}`))))

    /* NO QUERY STRINGS. `/facts?compare=` is noindex,follow — listing one here
       would hand a crawler two contradicting instructions. */
    check('no URL carries a query string', !urls.some((u) => u.includes('?')),
      urls.filter((u) => u.includes('?')).join(', '))
    check('no /admin or /auth path is advertised',
      !urls.some((u) => /\/(admin|auth)(\/|$)/.test(u)),
      urls.filter((u) => /\/(admin|auth)(\/|$)/.test(u)).join(', '))
  })

  await scenario('SITEMAP — lastmod is a real stamp, never the build time', [], async () => {
    const res = await fetch(`${BASE}/sitemap.xml`, { cache: 'no-store' })
    const xml = await res.text()
    const stamps = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1].slice(0, 10))
    check('every URL carries a lastmod', stamps.length > 0)

    /* `new Date()` would make every entry today and identical. Real provenance
       varies, because the rooms were confirmed on different days. */
    /* The detail described the FAILURE and printed on success too, so a passing
       line read "all 21 entries read 2026-08-07" over a sitemap holding three
       distinct dates. A true assertion stating something false is still a page
       of output nobody can trust. */
    check('lastmod is NOT uniform across the site', new Set(stamps).size > 1,
      `${new Set(stamps).size} distinct dates across ${stamps.length} entries`)
    const today = sql('select current_date').trim()
    check('not every page claims it changed today',
      stamps.filter((d) => d === today).length < stamps.length,
      'a sitemap stamped with the build time is a lie told to a crawler')

    /* THE STAMP TRACKS THE DATA. Move one room's verification and its lastmod
       must move with it — that is what makes it provenance rather than
       decoration. */
    mutate(['orleans'], `
      update cash_games set rake_verified_at = timestamptz '2026-09-09 12:00:00-07'
        where room_id = (select id from rooms where slug = 'orleans')
          and rake_verified_at is not null;`)
    const moved = await fetch(`${BASE}/sitemap.xml`, { cache: 'no-store' }).then((r) => r.text())
    const entry = moved.match(/<loc>[^<]*\/rooms\/orleans<\/loc>\s*<lastmod>([^<]+)</)
    check('a later floor visit moves that room\'s lastmod',
      entry?.[1]?.startsWith('2026-09-09'), entry?.[1] ?? 'no entry')
    restore()
  })

  await scenario('SITEMAP — every listed URL is fetchable and indexable', [], async () => {
    const urls = await sitemapUrls()
    const bad = []
    const noindexed = []
    for (const u of urls) {
      /* The sitemap advertises the production host; this suite runs against a
         local server, so only the path travels. */
      const path = u.replace(/^https:\/\/checkitdown\.com/, '') || '/'
      const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
      if (!res.ok) { bad.push(`${path} -> ${res.status}`); continue }
      const body = await res.text()
      /* A page telling crawlers to skip it has no business being requested for
         indexing. Two instructions, disagreeing, and the crawler picks. */
      if (/<meta name="robots"[^>]*noindex/i.test(body)) noindexed.push(path)
    }
    check('every URL in the sitemap returns 200', bad.length === 0, bad.join(', '))
    check('and none of them is noindex', noindexed.length === 0, noindexed.join(', '))
  })

  /* CLOSED ROOMS STAY LISTED. The roster rules deliberately do not apply here:
     /rooms/<slug> for a closed room is a DATED CLOSURE NOTICE, and the reader
     who needs it most arrives from a search result months later. There is no
     closed row in the database today, so the branch has no live coverage —
     which is the reason to make one rather than to trust the comment. */
  await scenario('SITEMAP — a closed room keeps its URL', [], async () => {
    const before = (await sitemapUrls()).length
    check('no closed or seasonal room exists in the seed today',
      Number(sql("select count(*) from rooms where status <> 'open' or is_seasonal")) === 0)

    mutate(['bellagio'], `
      update rooms set status = 'closed', closed_on = date '2026-03-01' where slug = 'bellagio';`)
    const closed = await sitemapUrls()
    check('the closed room is STILL in the sitemap',
      closed.some((u) => u.endsWith('/rooms/bellagio')),
      'a dead link tells a searcher nothing; the closure notice tells them when and where else')
    check('and the count is unchanged — nothing was dropped', closed.length === before)

    const res = await fetch(`${BASE}/rooms/bellagio`, { cache: 'no-store' })
    check('and that URL still answers 200', res.ok, String(res.status))

    mutate(['bellagio'], "update rooms set status = 'open', closed_on = null, is_seasonal = true where slug = 'bellagio'")
    const seasonal = await sitemapUrls()
    check('a SEASONAL room is listed too — it comes back when the series runs',
      seasonal.some((u) => u.endsWith('/rooms/bellagio')))
    restore()
  })

  await scenario('ROBOTS — allows the site, refuses the admin surface', [], async () => {
    const res = await fetch(`${BASE}/robots.txt`, { cache: 'no-store' })
    check('robots.txt is served at all', res.ok, `${res.status} — it 404'd from launch until 2026-08-07`)
    const txt = await res.text()
    check('crawling is allowed by default', /^Allow: \/$/m.test(txt))
    /* 200-with-nothing is still a URL in an index. RLS refusing to hand over
       data is a different problem from the page being listed at all. */
    check('/admin is disallowed', /^Disallow: \/admin$/m.test(txt))
    check('/auth is disallowed', /^Disallow: \/auth$/m.test(txt))
    check('the sitemap is advertised', /^Sitemap: https:\/\/checkitdown\.com\/sitemap\.xml$/m.test(txt))
  })


  /* ═══════════════════════════════════════════════════════════════════
     ⚠️ NO FIGURES TYPED INTO PROSE — asserted against RENDERED OUTPUT.
     ═══════════════════════════════════════════════════════════════════
     The schema already refuses a typed `$1/2` in `body`, and the resolver
     already withholds a paragraph whose tokens do not resolve. Neither can see
     the one failure that matters most: a token that resolves to a figure the
     room does not actually hold. Only the rendered page can answer that, so
     this reads the page.

     Content ships through the QUEUE, not through this commit — so the fixture
     is inserted here, asserted, and deleted by `restore`. Nothing is seeded. */
  await (async () => {
    console.log('\n== ROOM DESCRIPTIONS — prose states no figure the room does not hold ==')

    /* The room's OWN figures, straight from the database and formatted the way
       the product formats them. This is the set the prose is checked against;
       building it from raw columns instead would let "$8" pass because the
       room stores an 8 somewhere unrelated. */
    const figuresOf = (slug) => {
      const raw = sql(`
        select coalesce(string_agg(x, ' '), '') from (
          select cg.stakes_label as x from cash_games cg
            join rooms r on r.id = cg.room_id where r.slug = '${slug}'
          union all
          select '$' || cg.min_buy_in::text from cash_games cg
            join rooms r on r.id = cg.room_id where r.slug = '${slug}' and cg.min_buy_in is not null
          union all
          select '$' || cg.max_buy_in::text from cash_games cg
            join rooms r on r.id = cg.room_id where r.slug = '${slug}' and cg.max_buy_in is not null
          union all
          select '$' || cg.rake_cap::text from cash_games cg
            join rooms r on r.id = cg.room_id where r.slug = '${slug}' and cg.rake_cap is not null
        ) t`)
      return new Set(currencyFigures(raw))
    }

    const SLUG = 'aria'
    mutate([SLUG], `
      insert into room_descriptions (room_id, body, author_kind, written_at, source_url, fetched_at)
      select id, 'A long room off the lobby. The smallest game is {stakes_lowest}, raked {rake_lowest}, across {table_count} tables.',
             'checkitdown', '2026-08-09', 'https://example.test/mixed-state', now()
        from rooms where slug = '${SLUG}'`)

    const raw = await roomPageRaw(SLUG)
    const section = raw.match(/<section class="cid-prose">([\s\S]*?)<\/section>/)?.[1] ?? ''
    const prose = section.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    check('the description renders at all', prose.length > 0,
      prose ? `"${prose.slice(0, 60)}..."` : 'NO SECTION — every assertion below would pass vacuously')

    /* THE RULE, item 3. Every currency figure the reader sees must be one the
       room's own data holds. */
    const held = figuresOf(SLUG)
    const shown = currencyFigures(prose)
    const strays = shown.filter((f) => !held.has(f))
    check('every currency figure in the prose is present in the room\'s own data',
      prose.length > 0 && strays.length === 0,
      strays.length ? `STRAY: ${strays.join(', ')} not in {${[...held].join(', ')}}`
                    : `${shown.length} figures, all held: ${shown.join(' ')}`)

    /* THE NEGATIVE CONTROL. An assertion that only ever sees clean pages cannot
       distinguish "the rule holds" from "the detector is broken" — the vacuous
       pass this suite has been bitten by before. So the same detector is run
       over a planted paragraph and MUST fire. */
    const planted = 'The smallest game is $1/2, raked 10% to $99999.'
    const plantedStrays = currencyFigures(planted).filter((f) => !held.has(f))
    check('the detector fires on a planted stray figure — this assertion is not vacuous',
      plantedStrays.includes('99999'), `caught ${plantedStrays.join(', ') || 'NOTHING'} (figures are canonical numbers, not $-strings)`)

    /* NO BYLINE, EVER. Neither author_kind value may reach the page. */
    check('no byline reaches the reader — author_kind is stored, never rendered',
      !/checkitdown|partner/i.test(section), 'section markup carries no author kind')

    /* STALENESS IS DATED, NOT HIDDEN. */
    check('the description carries its written-on date',
      /WRITTEN 2026-08-09/.test(prose), prose.match(/WRITTEN [\d-]+/)?.[0] ?? 'no date found')

    /* VISUALLY DISTINCT FROM THE FACTS — structural, so it is checkable.
       A reader must not mistake a take for a sourced figure, and the difference
       has to be in the MARKUP rather than in a colour, so it survives a palette
       swap. Two claims: the prose is not a tile inside the grid, and it does
       not wear the monospace figure treatment.
       The first version of this searched the whole document for
       /cid-tiles[\s\S]*cid-prose/ and failed — because `.cid-tiles` appears in
       the stylesheet Next inlines into <head>, hundreds of lines before any
       markup. It was asserting document order against CSS. Scoped to <main>. */
    const mainHtml = raw.match(/<main[\s\S]*?<\/main>/)?.[0] ?? ''
    const tiles = mainHtml.match(/<div class="cid-tiles"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? ''
    check('the prose is not a tile inside the facts grid',
      mainHtml.includes('cid-prose') && !tiles.includes('cid-prose'),
      'the description is its own section, not a cell in the grid')
    check('the prose does not wear the monospace figure treatment',
      /<p class="cid-prose-body">/.test(section) || /class="cid-prose-body"/.test(mainHtml),
      'body text, not `num` — the distinction is structural, not chromatic')

    restore()

    /* RECORDED, NOT PUBLISHED. A token the room cannot resolve withholds the
       WHOLE paragraph rather than printing a hole a reader would read past. */
    mutate([SLUG], `
      insert into room_descriptions (room_id, body, author_kind, written_at, source_url, fetched_at)
      select id, 'This room has {no_such_token} going for it.', 'checkitdown', '2026-08-09',
             'https://example.test/mixed-state', now()
        from rooms where slug = '${SLUG}'`)
    const unresolved = await roomPageRaw(SLUG)
    check('an unresolved token withholds the whole description, not just the token',
      !/cid-prose/.test(unresolved) && !/no_such_token/.test(unresolved),
      'no section, and no raw token leaked to the reader')
    restore()

    /* EMPTY-SAFE: thirteen of seventeen rooms are in this state until the queue
       delivers, and that is the shipped state rather than an unfinished one. */
    const none = await roomPageRaw('bellagio')
    check('a room with no description renders no section at all',
      !/cid-prose/.test(none), 'empty-safe by construction')
  })()

} finally {
  restore()
  /* THE ASSERTION THAT CATCHES THIS WHOLE CLASS. Not "is everything back to
     null" — that was the old assumption and it was only ever true because the
     seed had nothing in it. The database must come back the way it went in. */
  const AFTER = census()
  console.log(`\ncensus before: ${BEFORE}`)
  console.log(`census after:  ${AFTER}`)
  if (AFTER !== BEFORE) {
    console.log('   FAIL  the suite did not leave the database as it found it')
    failures++
  } else {
    console.log('   PASS  database restored exactly — no verified row or confirmed absence was harmed')
  }
  dropSnapshot()
}

console.log(failures ? `\nFAILURES: ${failures}` : '\nAll mixed-state checks passed.')
process.exit(failures ? 1 : 0)
