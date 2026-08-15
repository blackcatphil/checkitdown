# Handoff: Growth Engine — Check It Down

## Overview

An internal operating console for **checkitdown.com** (independent map + verified facts for every poker room in the Las Vegas valley). It does two jobs:

1. **Analytics console** — the page a small team reads every Monday for 20 minutes. One north-star number, broken into the arithmetic that produces it, plus a room-level ledger.
2. **Growth system map** — the four growth loops written as input → mechanism → output, each with the conversion that gates it and the constraint that caps it.

Five tabs: **Engine · Loops · Rooms · Tests · Spec**. Audience is the operating team (small team, not investors). It is an internal tool — no marketing surface, no auth flows designed here.

Target repo: `blackcatphil/checkitdown` (branch `main`). Data sources available: **Google Search Console**, the **app database (Postgres/Supabase)**, and the **email platform**. No third-party analytics — see the Data layer section, which is the highest-value part of this brief.

## Where this lives

This bundle is meant to sit in the repo at **`docs/design/growth-engine/`** — README, the prototype, its screenshots and the design system, in one self-contained folder:

```
docs/design/growth-engine/
  README.md
  Growth Engine.dc.html
  support.js
  screenshots/            01-engine … 06-test-dialog
  _ds/modernist-4286b72e-0341-4302-a3fc-860038664147/
                          styles.css, readme.md, theme.json,
                          _ds_bundle.js, _ds_manifest.json
```

Nothing reaches outside the folder — the prototype's `<link>`/`<script>` paths are relative to it, so opening `Growth Engine.dc.html` straight from disk renders fully styled with no build step and no network. Keep the `_ds/modernist-…/` folder name intact; the paths are hard-coded to it.

## About the design files

The files in this bundle are **design references created in HTML** — a prototype showing intended look, structure and behavior. They are **not production code to copy**. The task is to recreate this design inside the checkitdown codebase using its existing framework, component patterns and data access layer. `Growth Engine.dc.html` uses a bespoke streaming-template runtime (`support.js`); do not port that runtime — read the markup for layout and the logic class for the model, then rebuild in the app's own idiom.

Every number in the prototype is **synthetic** (generated from smooth series with fixed noise, labelled "MODELLED DATA" in the UI). Nothing in it should ship as a constant. The Data layer section below defines what each number must actually be computed from.

## Screenshots

Full-page captures at 1440px, `screenshots/` — the reference for anything the prose below leaves ambiguous. Week W32 selected, sort default (sessions ↓), area filter All.

| File | Shows |
|---|---|
| `01-engine.png` | Engine tab, whole page: north star band, the equation, sum strip, revenue, loop gain, this week's read, cadence, footer poster |
| `02-loops.png` | Loops tab, all four loops with step chains, stats and constraint cells |
| `03-rooms.png` | Rooms tab: summary row, the 17-room ledger with all three status tags visible, totals row, read block |
| `04-tests.png` | Tests tab: stats row and the four-column board |
| `05-spec.png` | Spec tab: counted/not counted, sources, event table, guardrails |
| `06-test-dialog.png` | Test detail dialog (T-30), header / body / footer bands |

The dialog shot is at 2×; the tab shots are 1×. In `06` the dialog's internal scroll was disabled to show the full body in one image — in the running design the header and Close footer are pinned and only the middle band scrolls.

## Fidelity

**High-fidelity.** Colors, type, spacing, rules and states are final and come from the Modernist design system (`_ds/modernist-…/styles.css`, included in this bundle). Recreate pixel-for-pixel using that stylesheet's tokens and classes, or map them onto the equivalent tokens in the app.

Non-negotiables from the design system: **zero border radius anywhere**, **2px dividers** between major sections (1px between table rows), everything **flush left** (including button labels), **Archivo** for headings and body, accent red used sparingly — one place it runs as a field is the closing poster statement.

---

## The model behind the screens

Build this first. The UI is a rendering of it.

### North star — Weekly Active Players (WAP)

A unique device that opens Check It Down and reaches a **decision surface** — a room's live fact panel, a tournament filter result, or a promo detail — inside a Monday–Sunday week. Anonymous, device-scoped, no login. Deduped on a first-party id with a 400-day life.

**Not counted:** a bounce on the map with no filter applied and no room opened; bot and preview traffic; the team's own verification sessions (tagged and stripped before roll-up, or the reports loop measures itself).

Context line shown under the number: WAP as a share of ~61,000 people who sit down in a valley poker room in a given week.

### The equation (Engine tab, and the reason the tab exists)

```
new reach        ×  activation   =  new active
prior-week active ×  7-day return =  retained
                                     ─────────────
                     new active + retained = WAP
```

Every cell shows: value, week-over-week delta, an 8-week mini bar chart, and one line of context naming the lever. `activation` is deliberately called out as the smallest multiplier and the one furthest from its ceiling (~28% on comparable utility maps).

### The four loops

`gain` = players out ÷ players in, per cycle. Above 1.00 the loop compounds on its own. Values in the prototype are placeholders; compute them.

| # | Loop | Gain | Cycle | Owner | What it is |
|---|---|---|---|---|---|
| 01 | **Coverage** | 1.18 | 9 days | Eng | Verified room → generated page per room/game/stake → long-tail query match → organic session → player report → next room verified |
| 02 | **Reports** | 1.24 | 24 hours | Community | Fact ages past 24h → prompt on the fact itself → correction submitted → confirmed against a source → badge refreshes → player returns and reports again |
| 03 | **Partnerships** | 1.11 | 21 days | BD | Room page ranks for the room → room claims the listing → room sends changes first → schedule widget embedded on room site → inbound players |
| 04 | **Table** | 1.04 | 3 days | Community | Player finds an answer → shares a link → friend opens → friend activates → shares again (k = 0.12, does not self-sustain) |

Each loop renders five steps in equal-width cells with the gating rate above each step name, three stat cells, and a **constraint** cell (on `--color-surface`) naming what caps the loop. The constraints as designed:

- Coverage — pages ship faster than facts get verified; thin pages teach the crawler the whole site is thin.
- Reports — a third of reports can't be confirmed against a source, and confirming is manual.
- Partnerships — claimed rooms send updates but not links; it's a cheaper sweep, not yet a loop.
- Table — a shared link opens the map, not the thing that was shared; shared traffic activates at 19% vs 22.6% baseline.

### Revenue

Three lines, all priced off the same weekly active player, plus a per-WAP figure:

- **Featured placement** — rooms holding the top slot on the map (flat; the only line that grows without more traffic).
- **Referral & affiliate** — outbound room clicks × rate per click.
- **Promo sponsorship** — promos boosted in the weekly digest.

The per-WAP cell carries the honest read: revenue per weekly active player is flat, so the machine is compounding players, not yet dollars.

---

## Screens / Views

Shared chrome on every tab:

- **Header** — sticky, `z-index:30`, ground background, `padding:14px 32px`, `border-bottom:2px solid var(--color-divider)`. Left: brand `CHECK IT DOWN` (Archivo 800, 18px, `letter-spacing:-.01em`) + `GROWTH ENGINE` (11px, `.14em`, uppercase, `--color-accent`). Then tab buttons: `.btn` + `.btn-primary` when active, `.btn-secondary` otherwise, 12px, `.06em`, uppercase. Right: label `WEEK` + a `.seg` segmented control of three native radios (W30 / W31 / W32).
- **Status ribbon** — `padding:9px 32px`, `border-bottom:2px solid`, 11px uppercase `.1em` at `color-mix(in srgb, var(--color-text) 55%, transparent)`: `17 rooms · Median verify 9h · 3 rooms stale · W32 2026`, with a right-aligned `.tag.tag-outline` reading **MODELLED DATA** (remove once wired to real data).
- **Section padding** — `0 32px`. **Label style** used for every small caps label: 11px, `letter-spacing:.1em`, uppercase, text at 55%.
- **Footer poster** — full-bleed `--color-accent` field, `padding:52px 32px`, text in `--color-bg`. Kicker `OPERATING PRINCIPLE` (11px, `.14em`, 75% opacity); statement Archivo 800 46px, `line-height:1.02`, `letter-spacing:-.025em`, `max-width:24ch`: *"Accuracy is the product. A test that degrades a verified fact is a loss, whatever the metric says."*

### 1. Engine

**Purpose:** the Monday read. One number, its arithmetic, loop health, and the week's decision.

Layout, top to bottom:

1. **North star band** — two columns `minmax(0,1.05fr) minmax(0,1fr)` split by a 2px vertical rule, 2px rule below.
   - Left (`padding:36px 40px 36px 0`): label `NORTH STAR`; the number in Archivo 800 **104px**, `line-height:.86`, `letter-spacing:-.04em`; beside it the delta (Archivo 800 22px, `--color-accent-700` when moving the right way, `--color-neutral-700` when not) over `VS W31`; then `h4` "Weekly active players" and the definition paragraph (14px, `max-width:52ch`, `text-wrap:pretty`, text at 78%).
   - Target block (toggleable): 1px top rule, label row `Q3 TARGET · 12,500` / `7 WEEKS LEFT`, a 10px progress bar (`--color-neutral-300` track, `--color-accent` fill), then `Needs +4.9%/wk · running +6.2%/wk · on pace`. Required weekly rate = `(target / wap) ^ (1 / weeksLeft) − 1`.
   - Right (`padding:36px 0 36px 40px`): header row `WEEKLY ACTIVE PLAYERS · W19–W32` / `PEAK 8,933`; a **bar chart** — flex row, `gap:5px`, `min-height:200px`, bars `flex:1`, height mapped to 10–100% of the range `[min×0.78, max]`. Bar fills: selected week `--color-accent`, weeks before it `--color-neutral-500`, weeks after it `--color-neutral-300`. Below: 2px rule and a label row (9px, 45% text) showing every other week.
2. **The machine** — label, then two equation rows in a `minmax(0,1fr) 52px minmax(0,1fr) 52px minmax(0,1fr)` grid. Operator cells are `display:grid; place-items:center`, Archivo 800 26px in `--color-accent`, bounded by 2px rules on both sides. Metric cells: label, value (Archivo 800 **44px**, `-.03em`), delta (13px, 600), an 8-bar mini chart 26px tall with `gap:3px`, and a 12px context line at 70%. Row 1 bottom border 1px, row 2 bottom border 2px.
3. **Sum strip** — one flex row, Archivo 800 24px, `padding:20px 0`, 2px bottom rule: `3,209` *new* `+` `5,724` *retained* `=` `8,933` *weekly active players*, with the connective words in accent and a right-aligned 13px note "1,840 of them clicked through to a room this week".
4. **Revenue · this week** — label + one-line explainer, then `repeat(4, minmax(0,1fr))` between 2px rules. Three line cells (label, Archivo 800 30px value, delta, note at 62%) and a fourth cell on `--color-surface`: `PER WEEKLY ACTIVE PLAYER`, the $/WAP figure, and the read.
5. **Loop gain** — label + definition, then `repeat(4, minmax(0,1fr))` between 2px rules, each cell with a 2px left rule: `LOOP 01 · 9 DAYS`, gain in Archivo 800 38px (accent when ≥ 1.15, else `--color-neutral-600`) beside the loop name at 15px, an 8px health bar, the loop's one-line headline at 70%, and a `.btn.btn-ghost` "OPEN LOOP →" that switches to the Loops tab.
6. **This week's read · Monday, 20 minutes** — `repeat(3, minmax(0,1fr))`, cells `padding:22px 24px` with 2px left rules: accent kicker (MOVED / STUCK / NEXT), `h4` title, 13px body. This is written copy, not generated — keep it editable.
7. **Operating cadence** — `repeat(5, minmax(0,1fr))`: day (Archivo 800 15px, accent), action (13px 800 uppercase `.06em`), owner (11px uppercase at 45%), body (12px at 70%). Mon read / Wed ship / Thu read out / Fri sweep / Sun digest.

### 2. Loops

**Purpose:** the system map — why the number moves, and what's in the way.

Header: `h2` "Four loops. One is doing the work." beside a 56ch paragraph, 2px rule under. Then one block per loop, each with a 2px bottom rule and `padding:28px 0`:

- **Title row** — `LOOP 01` (13px 800 accent, `.1em`), `h3` loop name, and right-aligned tags: `.tag.tag-neutral` Cycle, `.tag.tag-neutral` Owner, `.tag.tag-accent` Gain.
- **Headline** — 14px, `max-width:88ch`, text at 78%.
- **Step chain** — `display:grid; grid-auto-flow:column; grid-auto-columns:minmax(0,1fr)`, 2px top rule, 1px bottom rule. Each step: `padding:16px 18px`, 2px left rule, `min-height:132px`; the gating rate on top (11px uppercase `.1em` in accent, `min-height:16px` so cells align when the first step has none), step name (Archivo 800 15px, `line-height:1.15`), note (12px at 65%).
- **Stats + constraint** — `repeat(3, minmax(0,1fr)) minmax(0,1.6fr)`, 2px bottom rule. Stat cells: label, value (Archivo 800 26px), delta. Constraint cell sits on `--color-surface` with an accent `CONSTRAINT` label and 14px body.

### 3. Rooms

**Purpose:** coverage and freshness per room against the demand each one pulls. Stale rooms are the leak.

Header: `h2` "Room ledger" + paragraph + a right-aligned `.seg` area filter (All / Strip / Downtown / Locals).

**Summary row** — `repeat(4, minmax(0,1fr))`, 2px bottom rule: room-page sessions (+ share of all sessions), outbound clicks (+ click rate), median verify age (+ count past 48h), rooms under 70% coverage.

**Table** — CSS grid, not `<table>`. Column template used identically on header, all rows and the totals row:

```
minmax(0,2fr) 84px 92px 74px 94px 128px 88px 92px
```

Columns: Room · Area · Sessions · 7d Δ · Outbound · Fact coverage · Verified · Status. Header row: 11px uppercase `.08em` at 60%, `padding:10px 0`, 2px bottom rule; Room / Sessions / Outbound / Fact coverage / Verified are click-to-sort and append ` ↓` / ` ↑` to the active label. Data rows: 14px, `padding:11px 0`, 1px bottom rule, hover `background: color-mix(in srgb, var(--color-text) 4%, transparent)`; room name Archivo 800 with `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`; numeric columns right-aligned; 7d Δ colored accent-700 / neutral-700; coverage renders an 8px bar (`--color-neutral-300` track, fill accent under 70%, neutral otherwise) plus the percentage; verified age turns `--color-accent-700` past 48h. Status tags: **≤12h** `VERIFIED` (`.tag-neutral`), **≤48h** `AGEING` (`.tag-accent-2`), **>48h** `STALE` (`.tag-outline`). Totals row: Archivo 800 14px, 2px bottom rule, carrying room count, aggregate CTR, total sessions, total outbound, mean coverage, median verify age.

**Read block** — `--color-surface`, `padding:22px 24px`, `max-width:96ch`, accent `READ` label + interpretation paragraph.

### 4. Tests

**Purpose:** one test ships every Wednesday, aimed at whichever multiplier in the equation is smallest. Nothing enters Running without a declared guardrail.

Header + a `repeat(4, minmax(0,1fr))` stats row (running now, win rate, median cycle, shipped this quarter). Then a four-column board: **Backlog · Running · Reading out · Shipped**, each column `border-left:2px solid`, `padding:18px 18px 28px`, `gap:12px`, header showing the column name (accent for Running / Reading out) and its count.

Cards use `.card.elev-sm`, `cursor:pointer`, hover `box-shadow:var(--shadow-md)`: `.card-kicker` = `T-31 · COVERAGE`, an ICE score at 11px/50% on the right, `.card-title`, `.card-body` = the target metric, `.card-meta` with a status note and a state tag. Clicking opens the detail dialog.

Nine seeded tests (keep as sample data or migrate into a real table): T-31 drive-time on room pages, T-35 room-supplied schedule feed, T-33 WSOP Circuit series hub, T-28 seat-open push, T-29 add-to-home-screen prompt, T-26 digest send time, T-30 report-a-change prompt, T-22 tournament filter defaults to tonight, T-19 verified-today badge.

### 5. Spec

**Purpose:** if a metric can't be traced to a row here, it doesn't go on the wall.

- **Counted / Not counted** — two columns split by a 2px rule, accent label on the left column.
- **Sources** — `repeat(3, minmax(0,1fr))` between 2px rules: name (Archivo 800 15px), role (11px uppercase accent), 13px description. Search Console / app database / email platform.
- **Events table** — grid `minmax(0,1.1fr) minmax(0,1.5fr) minmax(0,1.3fr) 168px`, header 11px uppercase at 60% with a 2px rule, rows 13px with 1px rules and the same hover tint. Event name in Archivo 800 13px; the "Feeds" column is a `.tag`.
- **Guardrails** — `repeat(3, minmax(0,1fr))` between 2px rules: title 15px 800 + 13px body.

### Test detail dialog

`.dialog-backdrop` (fixed, `inset:0`, `display:grid; place-items:center`, backdrop `--color-neutral-900` at 50%) with `z-index:60`. `.dialog` is `width:min(660px,100%)`, `padding:0`, **`max-height:calc(100vh - 32px)`**, laid out as three bands:

- **Header** (`flex:none`, 2px bottom rule): `T-35 · PARTNERSHIPS · BD` in accent, ICE right-aligned.
- **Body** (`overflow-y:auto; min-height:0`): `h3` title, then labelled blocks for Hypothesis and Design; a `repeat(3, minmax(0,1fr))` strip between 2px rules for Metric / MDE / Guardrail; then the state (accent label) with the result narrative.
- **Footer** (`flex:none`, 2px top rule): right-aligned `.btn.btn-secondary` Close.

Dismiss on backdrop click or Close. The header and footer stay pinned; only the body scrolls.

---

## Interactions & behavior

- **Tab switching** — instant, no transition. Active tab is `.btn-primary`. Tab state should live in the URL (`?tab=rooms`) so a Monday read can be linked; the prototype keeps it in component state.
- **Week selector** — three most recent complete weeks. Changing it re-reads *every* metric at that week index, moves the highlighted bar in every chart (earlier weeks neutral-500, later weeks neutral-300), and rescales the room ledger. All deltas are versus the week before the selected one.
- **Loop → tab jump** — "OPEN LOOP →" on the Engine tab switches to Loops. Should deep-link to the loop block (`#loop-02`) in production.
- **Table sort** — click a sortable header to sort by it; clicking the active column flips direction. Default `sessions` descending, `name` defaults ascending. The arrow glyph appears only on the active column.
- **Area filter** — filters rows and recomputes the summary row and totals from the filtered set, not the full set.
- **Test card → dialog** — opens on click; Escape should close it (add this — the prototype only wires backdrop click and the Close button).
- **Hover states** — table rows and event rows tint at `color-mix(in srgb, var(--color-text) 4%, transparent)`; test cards go from `--shadow-sm` to `--shadow-md`; buttons and tags use the design system's built-in states. Do not restyle focus: the system's `:focus-visible` is a 2px accent outline at `outline-offset:2px`.
- **No animation anywhere.** Nothing floats, nothing fades. Deliberate.
- **Responsive** — designed for desktop (≈1200–1600px). Below ~1100px the equation grid and the room ledger need a plan: stack the equation rows vertically with the operator glyphs becoming row separators, and give the ledger a horizontal scroll container rather than shrinking columns.

## State management

Component state in the prototype (six values) — map onto the app's routing/query layer:

| State | Values | Drives |
|---|---|---|
| `tab` | engine / loops / rooms / tests / spec | which section renders |
| `week` | index of the selected week (last 3) | every metric, every chart highlight |
| `sort` | name / sessions / out / cov / hrs | room ledger order |
| `dir` | 1 / −1 | sort direction |
| `area` | All / Strip / Downtown / Locals | room ledger filter |
| `openTest` | test id or null | detail dialog |

Configuration exposed as props in the prototype, worth keeping as settings: `defaultTab`, `chartWeeks` (6–14), `showTargets` (boolean), `targetWap` (the quarterly target the pace math reads).

Data fetching: one query per tab is fine — the Engine tab needs a single weekly-metrics row set (14 weeks), Rooms needs the per-room weekly roll-up, Tests reads the experiments table. Nothing here is real-time; cache to the hour and show the ribbon's verify age as the freshness signal.

## Data layer

The real build. Everything below replaces synthetic series.

### Event taxonomy — ten events, all written to the app database

| Event | Fires when | Properties | Feeds |
|---|---|---|---|
| `room_facts_view` | a room's fact panel is opened | `room_id, verified_age_h, source, surface` | Activation, WAP |
| `map_filter_apply` | any filter changes the visible set | `filter_type, value, result_count` | Activation, WAP |
| `tournament_row_open` | a tournament row expands | `room_id, buyin, start_ts, day_part` | Activation, WAP |
| `promo_detail_view` | a promo is opened from any surface | `room_id, promo_type, expires_at` | Activation, WAP |
| `outbound_room_click` | a link leaves the site for a room | `room_id, surface, position, sponsored` | Revenue |
| `fact_report_submit` | a player submits a correction | `room_id, field, agrees_with_current` | Reports loop |
| `verify_complete` | an operator finishes a room in the sweep | `room_id, fields_checked, minutes, source` | Reports loop |
| `digest_subscribe` | the subscribe form completes | `surface, prompt_variant, visit_number` | Digest channel |
| `share_link_copy` | share sheet or copy-link fires | `object_type, object_id, channel` | Table loop |
| `install_accept` | the app is added to the home screen | `visit_number, days_since_first` | Retention |

Every row also carries `device_id` (first-party, 400-day), `session_id`, `occurred_at` (UTC), `is_internal` (true for sweep sessions), and enough user-agent signal to drop bots.

The first four events are the **decision surfaces** — they define WAP. Keep that list in one place in code; the definition changing must change every number at once.

### The queries to write

- **WAP** — distinct `device_id` per ISO week over the four decision-surface events, `is_internal = false`.
- **New reach** — distinct devices in the week with no prior event ever.
- **Activation** — of those new devices, the share that hit a decision surface in the same week.
- **Prior-week active / 7-day return** — devices active in week *n−1* that are active again in week *n*.
- **Outbound rate** — distinct devices firing `outbound_room_click` ÷ WAP; revenue = clicks × the current per-click rate, held in config not code.
- **Median verify age** — per room, `now() − max(verify_complete.occurred_at)`; the ledger's status thresholds are 12h and 48h.
- **Fact coverage** — filled, sourced, in-date fields ÷ total fields tracked per room. Define the field list once; it is what the 70% threshold measures.
- **Corrections/wk and confirm rate** — `fact_report_submit` counts, and the share that reach a `verify_complete` on the same room+field.
- **Coverage loop** — pages indexed and query coverage come from **Search Console**: impressions, CTR and average position per query and per page, pulled weekly. Query coverage = distinct queries with an impression ÷ the tracked query set for room/game/stake terms.
- **Partnerships** — rooms claimed, share of updates whose `verify_complete.source` is the room itself, and inbound sessions from referrer = a partner domain.
- **Table loop** — `share_link_copy` counts, opens on shared links (tag the outbound link), activation on that cohort, and k = new activated players attributable to shares ÷ sharers.
- **Email** — sends/opens/clicks from the email platform, joined to sessions on a hashed subscriber id. Nothing about a player leaves the database to make that join.

Store the weekly roll-up in a materialised view keyed by ISO week so the console reads one row per week and the definitions live in SQL, auditable row by row.

### Guardrails (Spec tab, and they are real rules)

1. **Sourced or it doesn't ship.** Every fact carries a source and a verified timestamp. A test that raises a metric by loosening that rule is recorded as a loss.
2. **Sponsored is labelled.** Outbound clicks are never dressed as facts. Paid placement is marked in the interface and in the event stream, or it isn't sold.
3. **Two guardrails on every test.** Verified-fact accuracy and 7-day return are checked on all four loops before any winner is called, whatever the primary metric did.

## Design tokens

From `_ds/modernist-…/styles.css` — use the variables, not the literals.

**Color** — `--color-bg` `#f3f2f2` · `--color-surface` `#eae9e9` · `--color-text` `#201e1d` · `--color-accent` `#ec3013` · `--color-divider` `color-mix(in srgb, #201e1d 40%, transparent)`.
Neutral ramp: `100 #f8f4f4` · `200 #eae7e7` · `300 #d7d3d3` · `400 #bab6b6` · `500 #9b9797` · `600 #7d7979` · `700 #605d5d` · `800 #444141` · `900 #2d2b2b`.
Accent ramp: `100 #fff2ef` · `200 #ffe0d9` · `300 #ffc4b8` · `400 #ff9783` · `500 #ff563c` · `600 #dd2b0f` · `700 #ae1800` · `800 #7c1405` · `900 #4d170e`.
Accent-2 is a machine-derived stand-in — treat it as one role with accent; it is used only for the `AGEING` tag.

Movement color convention: `--color-accent-700` when a metric moves the way you want (including *down* for verify age), `--color-neutral-700` when it doesn't. Accent at paragraph size never appears — the 3:1 accent/ground ratio is for chrome and large type only.

**Type** — Archivo 400 / 600 / 800 (Google Fonts) for both `--font-heading` and `--font-body`. Body 15px / 1.55. Headings: `h1 42` · `h2 32` · `h3 25` · `h4 20` · `h5 16` · `h6 13` uppercase `.08em`; heading `line-height:1.12`, `letter-spacing:-.015em`. Display numbers in this design: 104px (north star), 44px (equation), 38px (loop gain), 30px (revenue and summary stats), 26px (loop stats). Small caps label: 11px, `.1em`, uppercase, text at 55%.

**Spacing** — `--space-1..8` = 4 / 8 / 12 / 16 / 24 / 32px. Section gutter 32px. Cell padding 16–24px. Card gap 12px.

**Radius** — `--radius-sm/md/lg` = **0px**. All of them. Do not round anything.

**Shadow** — `--shadow-sm` `0 1px 2px rgb(45 43 43 / 14%)` · `--shadow-md` `0 3px 10px rgb(45 43 43 / 16%)` · `--shadow-lg` `0 12px 32px rgb(45 43 43 / 22%)`. Used only on test cards and the dialog.

**Rules** — 2px `--color-divider` between sections, columns and cells; 1px between table rows.

**Components used** — `.btn` (`.btn-primary`, `.btn-secondary`, `.btn-ghost`), `.tag` (`.tag-accent`, `.tag-accent-2`, `.tag-neutral`, `.tag-outline`), `.seg` + `.seg-opt` with native radios, `.card` + `.card-kicker/-title/-body/-meta`, `.elev-sm`, `.dialog-backdrop` + `.dialog`.

## Assets

None. No images, no icons — the design is entirely typographic, and all charts are CSS grid/flex divs with percentage heights (no SVG, no chart library). Where a glyph is needed it is text: `×`, `=`, `+`, `→`, `↓`, `↑`. The design system nominates Lucide if icons are ever added.

## Files

- `Growth Engine.dc.html` — the full design: markup for all five tabs and the dialog, plus a logic class holding the metric model, the room and test data, the loop definitions and the event taxonomy. Read the logic class for the model, the markup for the layout.
- `support.js` — the prototype runtime. Reference only; do not port.
- `screenshots/` — six full-page captures, listed in the Screenshots section above.
- `_ds/modernist-4286b72e-0341-4302-a3fc-860038664147/styles.css` — the design system: tokens and component classes. This is the source of truth for every color, size and rule above.
- `_ds/modernist-4286b72e-0341-4302-a3fc-860038664147/readme.md` — the design system's own guide (dos and don'ts).
- `_ds/modernist-4286b72e-0341-4302-a3fc-860038664147/theme.json` — the machine-readable theme the stylesheet was generated from (color roles, ramps, type, density, radius). Use it if you need the tokens as data rather than CSS.
- `_ds/modernist-4286b72e-0341-4302-a3fc-860038664147/_ds_bundle.js` + `_ds_manifest.json` — the prototype's component runtime and its manifest. Needed only so the HTML renders standalone; do not port either into the app.

Open `Growth Engine.dc.html` in a browser to interact with it — tabs, week selector, sorting, filtering and the test dialog all work.

## Suggested build order

1. Event taxonomy and writes (the four decision surfaces first) — nothing else is measurable until these land.
2. The weekly roll-up view: WAP, new reach, activation, prior active, 7-day return.
3. Engine tab against real data, target math included.
4. Rooms ledger — needs the coverage field list defined and the verify timestamps exposed.
5. Search Console ingest → the Coverage loop's stats; then the Loops tab.
6. Experiments table → the Tests board and dialog. Until then, seed it.
7. Spec tab last — it's documentation of what you just built, and should be generated from the same constants the queries use.

## Not in scope here

Auth for the console, the partner login and schedule widget (test T-35), push notification infrastructure (T-28), and any player-facing UI. The prototype's synthetic data generator is a fixture, not a feature.
