# Check It Down — project docs

**checkitdown.com** — a desktop-first web product mapping every poker room in the
Las Vegas valley: games, rake, amenities, promotions and tournaments, ranking who
is best at what. Independent of the casinos; every fact carries a source and a
verified date.

Repo lives in `~/projects/` deliberately — **not** Desktop, because iCloud
Desktop & Documents sync has previously duplicated and deleted files under a
running dev server.

Note the lowercase. APFS here is case-insensitive, so `~/Projects/` resolves to
the same inode and any path written either way works locally — which is exactly
what makes the casing wrong in docs survive until it reaches a case-sensitive
filesystem (CI runners, Docker images, Linux) and fails there.

## Layout

```
checkitdown/
  docs/
    research/   competitor teardowns, palette audit, business plan
    design/     design briefs, master pivot brief, scope + architecture
  supabase/
    config.toml
    migrations/ 00000000000001_initial_schema.sql  ← the schema
```

## Where things stand (2026-08-04)

**Design: complete.** Six desktop surfaces built and measured in Claude Design —
landing map (3D, filter panel, popup, routable detail card), Just the Facts
(superlatives), Tournaments, Promos placeholder, plus the direction board. Token
library rebuilt as `--cid-*`; components replaced with what actually shipped.

**Schema: applied and exercised.** All eight pre-apply fixes folded in, applied
clean to local Postgres 17.10 (database `checkitdown`), verified by 20
behavioural assertions rather than structure alone.

Baseline: 15 tables · 1 view · 10 enums · 219 columns (3 generated) · 41 indexes ·
15 PK / 8 unique / 23 FK / 2 check constraints · 4 triggers · 15/15 tables
RLS-enabled · 12 policies.

**Environment: resolved.** OrbStack is installed and `supabase start` runs the
full local stack — PostgREST, Studio, Auth, and the real `anon` /
`authenticated` / `service_role` roles. `supabase db reset` applies the
migration and `seed.sql` end to end. **RLS is now exercised, not merely
declared**, over both `SET ROLE` and live PostgREST HTTP.

Doing that immediately found a total, silent breakage — see the grants entry in
locked decisions. Verified behaviour now: anon reads the content tables, is
refused on `sources` / `pending_changes` / `change_log`, can POST a correction
(201) and cannot read one back (401); service_role reads everything and writes.

## Tests

```
supabase test db      # pgTAP, supabase/tests/rls_test.sql — 10 assertions
```

Behavioural, not structural — because structural checks have twice passed while
behaviour was broken. It asserts anon can read every public relation, is refused
on the maintenance-loop tables, may submit a correction but never read one back,
and that `service_role` can read and write; plus RLS on every table.

**Its first assertion is the one that matters long-term:** the test fails when a
relation appears in `public` that it does not classify as `public_read`,
`service_only` or `write_only`. Adding a table without deciding who may read it
is a failing build rather than something to remember. Proven against three
injected regressions — revoking anon's SELECT (caught), leaking `sources` to
anon (caught), and adding an unclassified table (caught twice, since it also
has no RLS).

**Hand-testing PostgREST:** always send both `apikey:` and
`Authorization: Bearer`. With only `apikey`, the request silently executes as
`anon`, which is indistinguishable from a permissions bug — it briefly looked
like `service_role` was broken when the grants were fine.

**No hosted Supabase project yet** — deliberate. Local first; create the hosted
project when there is something to deploy, and verify current pricing first.

**Data: none yet.** Every figure in the design files is a researched placeholder.

## Build order

1. ~~Apply the schema~~ ✅ done, locally
2. **Seed data — 17 rooms, researched by hand.** ← current step. The real
   bottleneck; no scraper writes the first dataset
3. Next.js app reading from the DB (the six surfaces) — *needs the container
   runtime first, so RLS gets exercised*
4. Tier-1 scrapers for stable published sources — *but see the blocked-hosts
   constraint below; a third of the Strip can never have one*
5. Admin review queue (the `pending_changes` surface)
6. Cowork (Tier 2) — last, because it maintains what already exists

## The seeding rule

The research pass lands as **candidate data**: every row carries `source_url` and
`fetched_at`, and **`verified_at` stays NULL** until a human confirms it. Nothing
goes in as verified fact on the strength of a web search.

Anything only confirmable in person — time-collection rates, tableside food
hours, house rules — stays unverified indefinitely. The UI already handles that:
tilde'd, dotted rule, never ranked, and the exclusion line names the room and the
reason.

Better to launch with eight verified rooms and nine honest unknowns than
seventeen confident guesses.

## Blocked hosts — a third of the Strip has no tier-1 path

Found during the 2026-08-03 research pass. These five properties refuse
automated fetching outright — MGM returns no response at all, Golden Nugget
returns 403:

- ARIA, Bellagio, MGM Grand, Mandalay Bay (all four MGM properties)
- Golden Nugget

Four of them are Strip rooms, which is **half the Strip roster of eight**, and
they include the two biggest MGM rooms. They are currently sourced to Vegas
Advantage rather than to the casino itself.

This is a structural constraint on build-order step 4, not a bug to fix later:
no tier-1 parser will ever run against these hosts. It should shape the Cowork
tier split — these five are permanently Tier 2, and the tier boundary is
therefore about *host accessibility*, not about how stable the page is.

## Locked decisions worth not relitigating

- **Palette:** aubergine on ink. Accent `#5E3A93` (+1px `#A98CE8` lit top edge),
  accent type `#A98CE8`, mark `#8A66C9`, value teal `#4FBFAE`, base `#0C0E11`,
  surface `#14171B`, paper `#F2F4F6`. **No gold or bronze anywhere** — gold is
  what makes a brand read as a casino, and we are the independent tool.
- **Logo:** two knuckles, double knock. Checking is a knuckle rap on the table;
  a knock makes rings, which is also a map ping.
- **Type:** Instrument Serif (identity) / Archivo (UI) / IBM Plex Mono (every
  number, tabular).
- **Roster:** 17 permanent valley rooms. WSOP-Paris is `is_seasonal`, off the
  roster and all counts by default, restored when the series is live.
- **Provenance:** two states only — verified (date shown) and unverified
  (tilde'd, dotted rule, never ranked). When an unverified figure is excluded
  from a "best" column, **name the room and the reason**, never "1 room skipped".
- **Confirmed absence is a FACT, and the floor visit must record it.** "Verified"
  means we have confirmed the state of a fact **including confirming its
  absence**. Walk Horseshoe, find no tableside food: that is captured as
  *tableside food — confirmed absent*, never left blank. **A blank is
  indistinguishable from never having looked**, and the distinction collapses at
  the point of capture — no amount of care downstream can recover it, because
  the information was never written down. So the floor-visit checklist walks all
  twelve amenity slugs per room and records a yes or a no for each; skipping the
  no's silently converts a completed check into a permanent gap.
  The schema already carries this: `room_amenities.available` is
  `boolean not null`, so an absence is a row with `available = false` and a
  `verified_at`, not a missing row. **Never filter amenities without filtering on
  `available`** — a confirmed absence would otherwise render as a feature the
  room has.
  Downstream, every empty block therefore has two distinct states: *not checked
  yet* (a gap in our checking) and *checked, none present* (a finding). Reporting
  a completed check as a gap is the same unknown-as-negative error inverted, and
  it is covered by `npm run test:mixed`.
- **Enumerate while exclusions are the exception; summarise once they are the
  norm.** "Name the room and the reason, never a count" exists because *"1 room
  skipped"* is a hedge — it hides *which* room and denies the reader the chance
  to correct it. When every row is excluded there is nothing hidden: the reason
  is uniform, and listing seventeen rooms gives a reader nothing to act on.
  *"0 of 17 rooms are confirmed on site"* **is** the reason, fully stated.
  **Practical cutoff: if you can name them in one line, name them; past that,
  state the count and the reason.**
- **The zero-verified state is the PRIMARY state, not an edge case.** It is what
  the first real visitors see, on every surface. Design it first and make it look
  intentional; a surface that only looks right when full is a surface that will
  look broken on launch day.
- **`area` is a CLASSIFICATION field, not a fact field — same category as
  `slug`.** It is wayfinding, not a finding: nobody reads "STRIP" as a
  measurement. It therefore does **not** carry fact-provenance, even though it
  sits on `rooms` and rides that row's `verified_at`. Do not mark it editorial —
  the editorial label is for *judgements dressed as findings* (`reliability`'s
  "typically runs" is a claim about the world and needs marking); applying it to
  a navigational bucket would over-apply the rule until the label means nothing.
  Disputed classifications go through the correction flow. **Do not collapse
  `off_strip` and `locals`** — that distinction is real and players make it
  constantly, since rake, comps and game quality genuinely differ; losing it to
  dodge a judgement call costs more than the call.
- **Amenity filters are coverage-gated; a dim must never mean "we haven't
  checked".** A dim on the map *means* the room lacks the feature. That is only
  true where coverage is real: 7 of 12 amenity slugs currently match zero rooms
  and 11 of 17 rooms have no amenity data, so an amenity dim would darken rooms
  that probably do have the feature — rendering an unknown as a negative, in the
  product's most visible interaction. Every other surface has an unknown state
  (tilde'd, dotted, never ranked, exclusion line naming the reason); **the filter
  has none**, which is why it must only point at complete data. **v1 ships the
  GAMES group only** — 75 cash games across all 17 rooms, so a non-match really
  is a non-match. Amenity *data* still ships on the room detail card, where
  absence reads as absence-of-information. A group switches on **per slug**, once
  that slug is answered for enough rooms that the dim is a claim we can stand
  behind. Amenity facts aren't unavailable, they're **un-scrapable** — a person
  in the room knows all twelve in ninety seconds.
- **Two sources of truth drift, so games have exactly one.** Which games a room
  spreads lives in `cash_games.game` and is never duplicated into
  `amenity_types`. The filter panel's GAMES group queries `cash_games`
  directly. `amenity_types` covers only FOOD & DRINK / PARKING / COMFORT /
  SERVICES. Duplicating games into an amenity row means the day a room drops
  PLO, one of the two records is silently wrong and nothing detects it.
- **RLS is necessary but not sufficient — every table needs an explicit GRANT.**
  Postgres requires *both* a table privilege and a permissive policy. Supabase's
  default privileges give `anon` / `authenticated` / `service_role` only
  `TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` on tables a migration creates in
  `public` — no `SELECT` at all. With all 12 policies in place and the grants
  missing, PostgREST returned `42501 permission denied` to **every request, for
  anon and service_role alike**: the entire site and the entire ingestion path,
  dead, while the schema looked flawless (15/15 RLS-enabled, 12 policies, zero
  errors). `service_role` holds `BYPASSRLS`, which tempts you to assume it needs
  nothing — but BYPASSRLS skips the *policy*, it does not confer the
  *privilege*. **Any future migration that adds a table must add its own
  grants**, and no amount of schema inspection substitutes for calling the API
  as `anon`.
- **A row cites where ITS fact came from — never where its neighbours' came
  from.** Child provenance must never default to the parent's. We did exactly
  this once: `cash_games.source_url` was defaulted to `rooms.source_url`, which
  put a ranked $5 rake cap behind a Westgate page that never mentions rake.
  What makes this class dangerous is that **no automated check will ever catch
  it.** The foreign key was valid, nothing was orphaned, the integrity audit
  came back clean — a correct pointer to the wrong document is indistinguishable
  from a correct pointer. Referential integrity cannot detect semantic
  misattribution. Only reading the cited page can. The same caution applies to
  `coalesce(rake_source_url, source_url)`: right pattern, but only ever as sound
  as `source_url` being genuinely correct on that row.
- **Rake carries its own provenance.** `cash_games` has
  `rake_source_url` / `rake_fetched_at` / `rake_verified_at` alongside the
  row-level source, read as `coalesce(rake_source_url, source_url)`. Not
  general per-field provenance — rake specifically, because it is the most
  heavily ranked field in the product and rake and stakes routinely publish on
  different pages. Rake ranking gates on `rake_verified_at`.
- **Any column offered as a sort must have a real number behind it.** Strings are
  display only. *(Open: fixed-limit games — $4/8 LHE is a small bet and a big
  bet, not blinds or a spread. Either add `small_bet`/`big_bet` or document the
  convention, but don't leave the structure living only in `stakes_label`.)*
- **A sort's direction is part of the claim** — captions say which end is best
  and name the metric actually ranked on.
- **Rank is tied to the active sort and says so** (`# BY RAKE`, `# BY PARKING`).
- **Compare** dims in place and never reorders; true citywide ranks survive the
  "only my rooms" filter. URL is the source of truth, localStorage read only when
  the URL has no param. A non-empty set is `noindex,follow`.
- **Editorial content is labelled as editorial** and only exists where judgement
  fills a real gap (nobody publishes whether a daily tournament fires; rake and
  parking are published, so Just the Facts stays purely sourced).
- **Mobile is deferred, not abandoned.** Double-click has no touch equivalent, so
  the popup always carries an explicit OPEN FULL DETAILS affordance and nothing
  depends on hover alone. The parked mobile screens are stale in **scope**, not
  just palette — when mobile comes, do a fresh responsive pass from the current
  six surfaces rather than re-skinning the old ones.

## Still to file here

Downloaded from the Claude conversation — drop into `docs/research/` and
`docs/design/`:

- `CheckItDown-Palette-Audit.md`
- `CheckItDown-MASTER-Pivot-Brief.md`
- `Vegas-Poker-Site-MASTER-Build-Decision.md`
- `VegasPokerCalendar-Teardown.md`
- `PokerAtlas-Bravo-BuildDecision-Teardown.md`
- `V1-Scope-and-Architecture.md`
- `Cowork-Maintenance-Framework.md`
- `Las-Vegas-Poker-Platform-Business-Plan.pdf`
- the numbered design briefs (3–7)

Plus the Claude Design export: tokens, components, `SKILL.md`, and the built
`.dc.html` surfaces.
