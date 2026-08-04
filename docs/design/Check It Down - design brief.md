# CHECK IT DOWN — design brief
_Current state of the design, the rules that govern it, and what needs deciding. Supersedes all "Poker Map Alpha" briefs on name, platform, scope and palette._

---

## How to verify

Probe the DOM and read the measured numbers back. Do not eyeball. Every invariant below was measured in the live render.

**Data layer — query it, don't read the seed file.** Stack up via `supabase start`, then:
- `supabase test db` → **10 pgTAP assertions, all pass.** It fails if a relation appears in `public` that it does not classify as public-read / service-only / write-only, so adding a table without deciding who may read it is a failing build. Proven against three injected regressions (revoked anon SELECT; leaked `sources` to anon; unclassified new table).
- Counts: **17 rooms · 75 cash games · 12 amenity types · 8 room-amenity links · 42 sources** (18 rooms + 18 cash + 6 amenities — one page can be three maintenance jobs).
- **7 of 12 amenity types have zero rooms; 11 of 17 rooms have zero amenities.** These two numbers are the whole of decisions 1–3.
- `select count(*) from rooms where verified_at is not null` → **0**, and the same for `cash_games`, `room_amenities` and `cash_games.rake_verified_at`. Any non-zero means someone marked research as verification.
- **12 amenity types, not 17**: the panel has 16 checkboxes over five groups, GAMES holds 4, and games are not amenity types.
- `select count(*) from cash_games where small_bet is not null` → **27**; `where rake_type is null` → **2** (Horseshoe publishes no rake figure); `where rake_source_url is not null` → **13** (The Orleans, whose cap is sourced separately from its stakes).

**Board — `Check It Down - Palette and Logo.dc.html`** (desktop canvas, open in canvas/pan-zoom mode)
- Turn 4 `#4a` is the locked comp: **1240 × 1102**, header mark carries `knockR1`+`knockR2`, CTA fill **rgb(94,58,147)**, 8 pins with **0** behind the popup, panel clip **0**, 9 table rows, no gold.
- Six comps, all **1240 × 1102**: `#4a` (locked), `#2a` `#2b`, `#1a` `#1b` `#1c`. Logo cards `#1d`–`#1g` and `#3a`–`#3c` each **600** wide. Sections run newest-first: turn 4, 3, 2, 1.
- The purple comps are byte-identical to `#1b` apart from the accent: `#2a` CTA and checkbox fill **rgb(109,74,196)**, lead rank **#B9A3F2**, lead rake **#4FBFAE** (teal value); `#2b` fill **#5E3A93**, tint **#A98CE8**, value **#79BCD8**. Same 8 rooms, same 8 pins, 2 dimmed to 0.2.
- Superlatives table = **9 grid rows** (1 header + 8 rooms), **8 columns**: `# · ROOM · RAKE · DROP · PARKING · FOOD · TABLES · VERIFIED`. Heading reads **"Just the facts"**. No modelled figures on this table — cost-to-play and comps/hr are gone; the three superlative cards are LOWEST RAKE / BEST FOOD / MOST TABLES.
- Row 1 = `Orleans · 10% to $3 · $1 · Free self + valet · Full menu, tableside · 35 · 2 DAYS AGO`. Row 8 = `Wynn/Encore · ~$12 / half hr · — · $1.00 · … · UNVERIFIED`, tilde'd with a **dotted underline** (the estimate treatment).
- Filter panel reads **"6 of 17 rooms match"**; the map band has **8 pins**, of which the 2 non-matching are at **opacity 0.2** — dimmed, not removed. Map band is **364 px** tall so the side panel clips nothing (`scrollHeight − clientHeight = 0` in all five comps), and **all 8 pins are visible**: zero pin-vs-pin overlaps and zero pins behind the popup card, measured in every comp.
- **The mark has a rest state.** Every one of the 9 turn-4 marks carries exactly **1 un-animated ring** (`animationName: none`, stroke-opacity .5) under **2** animated ones, so the favicon, app tile, OG image, print and any frozen screenshot show a complete mark, never two bare dots. A `prefers-reduced-motion: reduce` rule freezes `knockR1`/`knockR2`/`knockTap` and `ping`, leaving the ring visible at .62 opacity.
- **The mark knocks twice.** `#3b` and `#1d` carry `knockR1`/`knockR2` ring animations (3.4 s cycle, second ring starting at 17 %) over a `knockTap` group that dips the knuckles 2 px on each strike — 10 animated ring nodes and 5 tap groups across the board, including the app-bar lockup and both app tiles.
- **No gold anywhere in `#1a`, `#1b`, `#2a` or `#2b`.** Grep both subtrees for `#C9A24A`, `#D9B45C`, `bronze`, `brass` — must be zero. Gold appears **only** inside `#1c`, which is the deliberate control.
- Turn 3 logo studies `#3a` `#3b` `#3c` each **600** wide, all rendered in the 2a violet (`#8A6BE0` / tint `#B9A3F2`), each showing header size, app bar, over-map, and 16/24/32 px. No gold in any of them.
- In `#1g` the ripple is centred on the dotless "i": ripple centre − glyph centre = **0 px** on all three lockups.
- Zero unresolved `{{ }}` holes in the rendered body; 28 inline SVGs; no console output.
- Tweaks: `tableSort` (rake/tables/food/parking) genuinely re-ranks all three tables at once; `dimNonMatching` toggles the pin dim and the match line; `showControl` hides `#1c`.

**Landing map, LIVE — `app/MapShell.tsx`** (real coordinates, `node scripts/map-fit.mjs`)
- **The mock's map invariants did not survive real geography, and the data is right.** The comp claimed *z11 · 0 rooms outside the crop · 8 pins standing for all 17 · 0 overlaps*. Measured against OSM property centroids: at z11 all 17 **do** fit the crop, but there are **20 overlapping pairs**, not zero. The valley is **26 × 29 km** with **8 of 17 rooms inside ~4 km of Strip**, and the closest real pair — Bellagio/Caesars — is **12.7 px apart at z12**. There is no zoom at which all 17 are visible AND nothing overlaps: by z12.5 overlaps fall to 2 but only 12/17 still fit.
- **So clustering is not decoration, it is forced**, and the invariant is restated honestly: *zero overlap between RENDERED pins*, guaranteed by 32 px absorption rather than by lucky coordinates.
- **Measured home view: centre 36.1309, −115.1709 at z11 → 10 rendered pins (8 singles + 2 clusters) representing 17/17 rooms, closest rendered pair 34.6 px** (≥ 32 px, so zero overlap). The clusters are the 7-room Strip block and a 2-room Westgate/Wynn pair.
- Three cluster states driven by the **GAMES-only** filter: all match → plain count; some → `hit/n` outlined; none → greyed. The number does the work dimming cannot.
- States the mock never showed, all handled: zero-verified (pins render, popup tilde's — a pin marks a location, which is not a claim that can be verified or ranked); `closed` (no pin, `/rooms/<slug>` still resolves to its dated notice); `temporarily_closed` (**pinned and badged**, dashed outline, consistent with the table); `is_seasonal` (off by default, restored by the panel toggle).
- Colour comes from tokens only — CSS custom properties on the pins, `readTokens(MAP_TOKENS)` for the one value Leaflet needs as a JS string. OSM tiles are darkened by CSS filter rather than shipping a second tile set.
- **Not ported this pass:** the extruded 3D massing. It is a bespoke canvas layer, the brief already scopes it to Strip-only Tier B, and Overpass footprints were unreachable from this environment. The map is Leaflet + OSM + pins today.

**Landing map, MOCK — `Check It Down - Landing Map.dc.html`** (desktop, 100vh app shell)
- **Contrast: zero failing text.** Every text node on the landing map was measured against its real backdrop — **0 below 4.5:1**. One dim token now carries all secondary text: `rgba(242,244,246,.58)` (≈5.3:1 on `#14171B`) for group headings, filter counts, the `/rooms/<slug>` route line, fact-cell notes and freshness lines; `.6`–`.62` for the next step up. Only the zero-match counter sits lower, and it is a disabled-state marker.
- **The filter dims the city, not just the legend.** Checking a feature greys the extruded buildings as well as the pins — measured across the canvas: lit samples **90 → 71**, grey samples **16 → 33** on "Free self-park". Nothing is removed.
- **Clusters carry three states**, because at entry zoom the Strip is one pin and a two-state cluster lies at both ends: all matching → plain count (`9`); some matching → **`1/9`** in an outlined violet partial pin, the number doing the work dimming can't; none matching → `0/9` greyed. Measured live: Strip cluster reads `9` unfiltered and `1/9` under "Free self-park".
- **The header fits at 924 px in every state**, measured `scrollWidth === clientWidth`, 0 elements past the viewport edge: empty set → `Check It Down · MAP · JUST THE FACTS · TOURNAMENTS · PROMOS · 17 ROOMS · VERIFIED DAILY`; with the chip → the status collapses to `VERIFIED DAILY` and the chip shortens to `COMPARE n`. Both header groups are `min-width:0; flex:0 1 auto` so neither can force an intrinsic minimum again — the earlier break was two nowrap groups that could not shrink, not a pixel value. VERIFIED DAILY is the trust signal and never drops.
- **The compare set has a designed empty state and a collapsible dock.** Before anything is collected, the filter panel carries a COMPARE ROOMS block explaining the loop; after, it flips to YOUR COMPARISON. The header chip reacts at **one** room (`COMPARE 1`, and the tray header spells out "1 ROOM TO COMPARE") so an add always registers; the tray appears at **two**. The tray and the glance popup now own **lanes that cannot intersect**: the tray is capped at **236 px wide × 190 px tall** with internal scroll, so at any set size it stays left of the popup's left edge. Measured with 5 rooms collected and a popup open: **no overlap**, and `elementFromPoint` at both the CTA's and the freshness line's left edges returns popup elements, not tray. Toggle: **192 px expanded → 34 px collapsed**; collapsed it covers **0 pins**. Expanded it can sit over one pin — the accepted cost of a persistent dock, and one click clears it. Recenter restores `z11 · 0 outside · 8 pins · 17 rooms`.
- **No hard cap on the set** — compare is a row filter on a table that already renders 17 rows, so a fifth pick costs nothing structurally. The **display** is soft-capped: the tray lists 4 rooms and collapses the rest to "+n more in the set". Revisit only if compare ever becomes side-by-side columns.
- **Persistence: the URL is the source of truth.** `?compare=aria,orleans` mirrored to `localStorage`; on load, localStorage is read **only when the URL carries no compare param**, so a shared shortlist link can never be overridden by a stale saved set. Measured: adding two rooms writes `?compare=south-point,boulder-station` and `cid_compare` together, and the set survives reload.
- **A compare-filtered view is never indexable.** Whenever the set is non-empty the page carries `<meta name="robots" content="noindex,follow">` and a canonical link back to the clean path — otherwise every `?compare=` permutation mints a thin duplicate of one of our SEO pages.
- **The primary action is ADD TO COMPARE**, not the brand name — a CTA has to describe its own action, and a device-local bookmark leads nowhere. Filled aubergine `rgb(94,58,147)` → outlined `✓ IN COMPARE` once added, with a persistent **COMPARE n →** chip in the header that routes into Just the facts filtered to the picks. That is the product loop: browse the map → collect rooms → land in the differentiator.
- **Entry view shows the whole city.** On load the map fits the valley: **zoom 11, 0 rooms outside the crop, 9 pins standing for all 17 rooms, 0 pin overlaps**, nothing selected and no popup until the user clicks. Rooms too close together at that scale collapse into a **cluster pin carrying its count** (e.g. the Strip as one pin reading 8–10); clicking a cluster zooms into it. The street-level 3D massing is the reward for zooming in, not the entry state.
- **Every view reset routes through the fit**, so no control can restore a broken framing. Measured across all four paths: load `z11 · 0 outside · 17 rooms · 0 overlaps` · FLAT `z10.5 · 0 · 17 · 0` · back to 3D `z10.5 · 0 · 17 · 0` · recenter after zooming to 14 `z11 · 0 · 17 · 0`. Recenter now calls the fit and clears the user-took-over guard rather than restoring a hand-picked zoom.
- One more measurement-only bug worth recording: the ease-out stepped zoom by 0.25 while the map's `zoomSnap` rounds to 0.5, so the step was a silent no-op and the loop spun 12 passes changing nothing. Step and snap now match.
- The fit is solved, not guessed: it measures the projected bounding box against the exact window the labels are culled by and eases out until every room passes, re-running on any stage resize until the user takes over. Two bugs found by measuring rather than eyeballing: a stray cluster block had been duplicated into `paintSel()`, throwing `placed is not defined` and killing the whole startup block; and the programmatic fit's own `zoomstart` was tripping the "user took over" guard.
- Shell: 64 px header (knock lockup + MAP / JUST THE FACTS / TOURNAMENTS / PROMOS, single-line, no wrap) · 302 px persistent filter panel · map fills the rest. No sheets, no drawers.
- Filter panel: 5 groups (GAMES / FOOD & DRINK / PARKING / COMFORT / SERVICES), 16 checkboxes, each with a live count, AND logic, one-click CLEAR. Checking **Free self-park** yields **"9 of 17 rooms match"** and posts a `dim` message that greys the 9 non-matching pins in the map iframe — **dimmed, never removed**. Verified live: 18 label nodes, 9 dimmed.
- Popup (single click): status dot, name, tables + spread, rake + drop, hook, verified date, the route `/rooms/<slug>`, and an explicit **OPEN FULL DETAILS** button — the affordance that keeps the two-level pattern alive on touch, where double-click does not exist.
- Detail card, **two presentations, one content model**: (a) modal over the map from a double-click — 1080 px, scrim, ESC and × to close, map visible behind; (b) standalone page at `?view=page&room=<slug>` — site header stays, scrim and close button are `display:none`, the map shell does not render at all, page scrolls. Verified: `?view=page&room=venetian` renders Venetian as a page.
- Detail content: THE FACTS 8-cell grid (rake, drop, comps, hours, tables, parking, food, verified) · CASH GAMES table with min/max buy-in visible without interaction · AMENITIES and HOUSE RULES as label/value pairs · PROMOTIONS · footer with per-section freshness and "Report a correction". One filled action only (CHECK IT DOWN); DIRECTIONS and CALL are outlined.
- Unverified rooms (Wynn/Encore) render tilde'd with a dotted underline and neutral-grey flags — no ochre anywhere.
- **Knock: once on load, replayed on hover.** The animation lives in a `.knocking` class, not an inline shorthand, and the logic removes it, forces reflow and re-adds it on `mouseenter` — measured: ring opacity **0.90** at 160 ms into a hover replay, **0** at rest, with the static ring still holding the mark. Nothing depends on the replay, so touch (load-only) loses nothing.
- **Popup dismissal is real.** `popupOpen` is gated on an actual selection: × closes the glance card and it stays closed (no silent fall-through to another room). Measured: select Bellagio → shows Bellagio → × → closed → select Venetian → shows Venetian.
- Seasonal: WSOP·Paris is `seasonal:true` in the data, off the roster, the pin set and every count by default; the panel's **Show series venue** toggle posts `season` to the map and it appears. Header reads **17 PERMANENT ROOMS** / **17 PERMANENT + WSOP LIVE**.

**Just the facts — `Check It Down - Just the Facts.dc.html`** (desktop, 1240 max width)
- **Rank is tied to the active sort and says so.** Header reads `# BY RAKE` / `# BY PARKING` and the numbers re-render: by rake `#1 Orleans · #2 South Point · #3 Green Valley Ranch`; by parking `#1 Orleans · #2 South Point · #3 Red Rock`. Sort controls live **in the sticky table header** next to the columns they sort; the active column carries a ↓ and full-strength ink.
- **Teal stays on the true #1 even when it is dimmed.** Measured with a compare set active and the leader not among the picks: rank ink `rgb(79,191,174)` on a row at `opacity 0.42`. One best-signal on the screen; the dim does the personalising.
- **Compare state dims in place and never reorders.** Picks stay lit at their real position, everything else drops to 0.42. "ONLY MY ROOMS" collapses the view and still shows **true citywide ranks** — measured shortlist: `#2, #3, #4, #5, #8, #9, #12`, never renumbered 1-2-3. CLEAR SET restores all 17.
- **The excluded room is named, not counted:** "Wynn/Encore's rake is unverified — it collects by time, and we have not confirmed the figure with the room, so it cannot be ranked", with report-a-correction beside it. It still appears in the table, tilde'd with a dotted rule, ranked `—`.
- Four superlative cards double as the category anchors — `#lowest-rake`, `#best-parking`, `#best-food`, `#most-tables` — real fragment URLs that also set the sort, and the active one takes the accent rule.
- **Freshness is a number, not a string.** Each room carries `verDays` (Wynn/Encore `null`) and the label is derived from it, so the VERIFIED sort really reorders: `#1 Venetian YESTERDAY · #2 ARIA YESTERDAY · #3 Orleans 2 DAYS AGO … #16 Skyline 6 DAYS AGO`, with Wynn/Encore last and ranked `—`. Teal lands on the true freshest (`rgb(79,191,174)`), and the exclusion line re-words for this sort: "Wynn/Encore has no confirmed check date — we have never verified it with the room, so it cannot be ranked by freshness."
- 17 rows, no horizontal overflow (`body.scrollWidth 914 ≤ 924`), 0 clipped elements, **0 text nodes below 4.5:1**, one filled action only, `robots: noindex,follow` whenever a compare set is active.

**Tournaments — `Check It Down - Tournaments.dc.html`** (desktop, 1240 max width)
- **Groups are the default view, not a permanent frame.** Time sort renders 4 sticky group heads — `RUNNING NOW 3 EVENTS · TONIGHT 8 · TOMORROW 4 · LATER THIS WEEK 3` — with ranks running `#1`–`#18` continuously across them. **Any non-time sort flattens them: 0 group heads**, one citywide ranking, and a banner that says so — "Sorted by fee % — time groups are flattened into one citywide ranking, so #1 is the best in the valley, not the best tonight." BACK TO TIME restores all 4 heads.
- **Every sortable column has a number behind it, and the number matches the caption**: START `start` · BUY-IN `entry+fee` ascending (`#1 Nightly $45 … #18 Mystery Bounty $1,100` — cheapest first, same direction as FEE %) · FEE % `fee ÷ total` · GUARANTEE `gtd` · **PACE `stack × level ÷ 60`** (chips per level-hour). Depth is a big stack **and** long levels, so the level term multiplies; dividing by it rewarded short levels and flagged Red Rock's Nightly Turbo as deeper than the WSOP Mystery Bounty. Measured: `#1 Mystery Bounty DEEP 30,000/40M … #18 Nightly Turbo TURBO 8,000/12M`. Thresholds DEEP ≥ 6,000 · TURBO ≤ 2,500. The caption names the metric actually used — "starting stack against level length (chips per level-hour)" — and the displayed order is monotonic in it: `20,000 → 10,000 → 8,333 → 6,667`. Rank header re-qualifies with the sort (`# BY START` / `# BY FEE %` / `# BY GUARANTEE`), teal on the true #1.
- **Our read is editorial, and labelled as such.** Column subhead reads `EDITORIAL · NOT SORTABLE`, the header is not clickable (`cursor: auto` against `pointer` on all five sortable heads), the values carry **no colour**, and the table footer states it is our judgement from watching events run, not a room-published figure. It is never ordinalised.
- **The buy-in convention is stated on screen:** "Fee % is the house's cut as a share of the **total** buy-in — a $200 event with a $30 fee is 15%. Measured against the prize pool instead it would read 17.6%."
- Unconfirmed guarantees follow the Cash rule: Bellagio's `~$10,000` is tilde'd with a dotted rule, and on the GUARANTEE sort it and the five events advertising none fall to the bottom ranked `—`, with the exclusion line naming them.
- Detail is routable — row → modal at `/tournaments/<slug>`, deep-linkable via `?event=<slug>`. Dailies link the room's published PDF with its fetched date; the WSOP series event carries the full level-by-level transcription. **Exactly one filled action on the screen** (`ADD TO CALENDAR`, `rgb(94,58,147)`); REMIND ME is outlined and says "on this device".
- Header status reads **18 EVENTS LISTED**, not "today" — 7 of the 18 sit in TOMORROW and LATER THIS WEEK.
- 18 events, `body.scrollWidth 914 ≤ 924`, **0 text nodes below 4.5:1**, no console output.

**Promos — `Check It Down - Promos.dc.html`** (desktop, 1240 max width)
- States intent, not a countdown: `NOT BUILT YET` over the statement line **"City-wide promotion tracking"**, then what would be tracked (high hand · bad beat jackpot · splash pot / freeroll · locals rate), each with the source and cadence it would carry.
- Two notes carry the argument: **why the page is empty and not faked** (invented jackpot totals would be the most convincing and least true thing in the product) and **what unblocks it** (17 room pages read daily into the review queue, plus a rule for what counts as current).
- One filled action — `SEE WHAT IS BUILT` — plus a quiet "Report a promotion you have seen". No fabricated figures anywhere on the page.

**Built mobile screens** (now reference, see §4) — unchanged from the previous brief; their own invariants still hold: 402 px width, no horizontal overflow, 44 px targets, tabular numerals, one filled brass action each. They are **not** part of the v1 desktop surface.

---

## 0. Direction — LOCKED

**Palette 2b (aubergine on ink) + logo 3b (two knuckles, double knock).** Everything downstream inherits these:

| Token | Value | Use |
|---|---|---|
| Accent surface | `#5E3A93` + 1px `#A98CE8` lit top edge | the single primary action per screen, checkbox fills, section rules. If it still recedes on the real superlatives page, lift the fill to `#6E45AC` for actions only |
| Accent type | `#A98CE8` | accent text on ink, the mark's rings, active nav |
| Mark solid | `#8A66C9` | knuckle fills |
| Value / verified | `#4FBFAE` | good rake, verified figures, live dot — **teal, decided on accessibility grounds**: deutan/protan vision dims purple’s red component and pulls it toward blue, which is exactly where steel blue `#79BCD8` sat |
| Base / surface | `#0C0E11` / `#14171B` | page, cards and panels |
| Paper type | `#F2F4F6` | body copy on ink |
| Type | Instrument Serif · Archivo · IBM Plex Mono | identity · UI · all numbers, tabular |

No gold, no bronze, no green-as-good, no red-as-warning. Comp `#4a` on the board is the assembled result — the knuckles mark in the header of the aubergine shell — and `#2a`, `#1a`–`#1c`, `#3a`/`#3c` are kept only as the record of why.

## 1. What this is

**CHECK IT DOWN** — checkitdown.com. A desktop-first web product mapping every poker room in the Las Vegas valley with its games, rake, amenities, promotions and tournaments, and ranking who is best at what. Independent of the casinos; the reason to use it is that every fact carries a source and a verified date.

"Poker Map Alpha" / "Poker Map" is retired as a name. File names still carry it and are renamed as each screen is rebuilt (see decision 9 below).

**Platform:** desktop first, mobile deferred but coming. Every desktop decision must leave a viable phone path — notably, **double-click has no touch equivalent**, so the popup always carries an explicit `OPEN FULL DETAILS` affordance, and nothing depends on hover alone.

---

## 2. Where the build is right now

| Status | Surface |
|---|---|
| **Built** | `Check It Down - Promos.dc.html` — the honest not-built-yet page · `Check It Down - Tournaments.dc.html` — the tournaments table + routable event detail · `Check It Down - Just the Facts.dc.html` — the superlatives table · `Check It Down - Landing Map.dc.html` — the landing map, filter panel, popup, and the detail card in both presentations · `checkitdown-map-3d.html` — the 3D module re-skinned to the locked palette · `Check It Down - Palette and Logo.dc.html` — the direction board |
| **Next, in order** | Nothing on the public surface. The design system is now the open work — see §10. |
| **Reference only (mobile, parked)** | Rooms Near Me · Room Detail · Cash · Promos · Tourneys · Tournament Detail · Me · First Run & States · Article · Waitlist Card States |
| **Carries over intact** | `poker-map-3d.html` (Tier B massing) · `poker-map-tier-a.html` (Tier A Leaflet/OSM) · Room Detail's content model · `components/` · `tokens/` |
| **Internal** | `Poker Map - Admin Review Queue.dc.html` — stays available, not part of the public product |

---

## 3. The board — the record of why

Kept as the argument behind §0, not as an open question. Each comp pairs the landing map with the superlatives table, because the map flatters any palette and the table is where an accent plus a semantic colour either works or breaks.

- **1a — Ink & vermilion, LIGHT UI.** Paper `#F5F6F7`, surface `#FFFFFF`, ink `#0D1013`, vermilion `#DE3C14`, value steel blue `#1F6C8C`. The dark 3D map sits inside a paper interface.
- **1b — Ink & vermilion, DARK UI.** Base `#0C0E11`, surface `#14171B`, paper text `#F2F4F6`, vermilion `#F04E22`, value `#6FB6D4`.
- **1c — CONTROL, red/black/gold.** `#B3122C` + `#C9A24A` + `#0B0B0C`. Included so the decision is informed, not asserted.

**Turn 2 — dark purple, on the chosen dark shell.** You picked 1b's dark UI and asked to see purple instead of vermilion. Only the accent moves, so the table stays a fair comparison.
- **2a — Deep violet.** Surface `#6D4AC4`, text tint `#B9A3F2`, value **teal** `#4FBFAE`. Holds enough urgency for a primary action.
- **2b — Aubergine.** Surface `#5E3A93`, text tint `#A98CE8`, value steel blue `#79BCD8`. Quieter; the CTA starts to recede.
- Purple needs **two values on ink** — a saturated surface for fills, a lighter tint for type — because a dark purple set as text on near-black fails contrast. Purple is also the emptiest space in the category and never reads as a warning, so the superlatives table keeps its full colour vocabulary. The risk is casino-lounge velvet; staying cool and desaturated is what avoids it.

**Why 1c lost:** the gold table chrome makes every row look promoted by the house, and green-good against red-brand puts a traffic light inside a ranked table. **Why vermilion lost to purple:** red is the most crowded space in poker, and a red brand colour cannot also mean caution.

**Logo — the knock, not a checkmark.** Checking is a knuckle rap on the table, and a knock makes rings — the same shape as a map ping.
- **1d Knock ripple** — irregular, open rings around a tap point. Survives 16 px, single colour, no casino cliché. Rings are asymmetric and broken so they read as impact on a soft surface, not wifi.
- **1e Two knuckles** — most insider, weakest at favicon size (reads as two dots).
- **1f Knock + down** — rings resolving into a downward chevron; busier small.
- **1g Wordmark-integrated** — ripple as the dot of the "i" in IT. Best as the full lockup; needs 1d as the standalone mark.

**Turn 3 — 1e worked up**, since you wanted to see the knuckles further. All three in violet, on the 2a shell.
- **3a As drawn** — two knuckle points and the felt line. Honest, but with no motion in it, 16 px is just two dots.
- **3b With the strike — CHOSEN** — two knuckles, two knocks: the leading one lands twice and throws a ring each time. Keeps the insider gesture, gains the map-ping shape, holds at 16 px, and the ring gives the lockup a horizontal lead-in so the mark points at the wordmark. Shown as an app tile reversed on violet and on ink.
- **3c Three-quarter angle** — three knuckles at the angle a hand really lands. The most literal, and the most likely to read as an ellipsis or a braille cell.
- **3b vs 1d:** 1d is the cleaner symbol and the safer favicon; 3b is the more specific one — a hand, not a signal.

---

## 4. Scope — six surfaces

1. **Landing page = the Tier B 3D map**, full-viewport, all rooms at true coordinates. Controls and filters in a persistent side panel, not a sheet.
2. **Click behaviour, two levels** — single click → popup (name, status, area/distance, tables, stakes spread, promo hook, `OPEN FULL DETAILS`); double click → full detail card, reusing Room Detail's content re-laid-out for desktop. The popup's explicit CTA is what makes the pattern survive on touch.
3. **Amenity + game filter — the signature interaction.** Grouped checkboxes (GAMES / FOOD & DRINK / PARKING / COMFORT / SERVICES), AND logic, live match count, one-click clear. **Dims non-matching rooms rather than removing them** — you can see what you are ruling out. This replaces the area filter as the primary control.
4. **Tournaments** — sortable table only for the desktop pass; **tournament detail follows Room Detail's modal-plus-page treatment and must be routable the same way** (`/tournaments/<slug>` plus the modal), because event pages are long-tail SEO in their own right. The structure rule carries over unchanged: **dailies link the room's published PDF with its fetched date; series get the full level-by-level transcription.** The table itself: time axis, honest buy-in split, rake convention stated, run-reliability as a **column, not a badge**, and **fee percentage sortable** — it is that screen's "lowest rake".
5. **Promos** — parked. Tab exists; the placeholder reads **"City-wide promotion tracking — not built yet."** No "coming soon", no "in build" — both read as promises and the scope is genuinely undecided.
6. **Superlatives / review** — "Just the facts". **Arriving from the compare chip, picks are dimmed in place and never pinned to the top** — rank position is load-bearing here (caution is carried by position, not colour), so hoisting a #11 room into second place would make the table say something false, and it would break the dim-don't-remove rule the map already follows. The "only my rooms" switch does the collapsing job, and even filtered it shows **true citywide ranks (#1, #11, #14)**, never a renumbered 1-2-3 — "my shortlist is #1, #11 and #14" is the useful sentence. Category anchors ship as **real fragment URLs now** (`#lowest-rake`, `#best-parking`, `#best-food`) so links exist and can be shared; splitting into per-category pages waits until real data shows real query demand — five thin pages on placeholders would be premature. Arriving from the header chip, the table is **filtered to the compare set**.
  "Just the facts": what each room actually charges and offers, ordered so the best is obvious. Editorial, from our own research, not user reviews. **Observed and published facts only** — rake, drop, parking, food, tables. Derived economics (cost per hour, comps rates) are out of this table; if they return it is as a separate, clearly-modelled view.

**Parked (files kept, off the v1 surface):** mobile layouts and the PWA install path · crowd reporting and its corroboration flows · wait times, live status, the vendor/OFFICIAL treatment, the waitlist button · the predicted/estimate source · First Run & States · the Me screen.

---

## 5. Provenance — simplified, not dropped

Every fact still carries a source and a verified date. With no crowd or vendor feeds in scope, three visually distinct sources collapse to two:

- **Verified** — plain figure, date shown (`VERIFIED 1 DAY AGO`, `2 DAYS AGO`).
- **Unverified / estimated** — value tilde'd (`~$12 / half hr`), **dotted underline**, `UNVERIFIED` in place of a date, never stated as a hard number and never allowed to win a superlative.
- **When an unverified figure is excluded from a "best" column, name the room and the reason** — "Wynn/Encore's rake is unverified and can't be ranked", never "1 room skipped". A bare count reads as a hedge; naming it reads as honesty, routes the reader into report-a-correction, and doubles as a visible to-do for the data pipeline.

---

## 6. Colour rules

- **Aubergine = identity only** — the mark, accent type, and the single primary action per screen. It is not a warning colour.
- **Value / good = teal `#4FBFAE`.** Distinguishable from aubergine across common colour-vision types, and far enough from felt green that no-green-as-good survives.
- **Caution is carried by rank position, weight and size**, not colour. Unverified data is flagged in **neutral grey** — never ochre, which sits too close to the banned gold, and grey reads as "not yet confirmed" rather than "warning".
- **No gold. No bronze. Anywhere.** This is the rule doing the most work: gold is what makes a brand read as *a casino*, and we are the independent tool that says which casino treats you best.
- Type is unchanged: **Instrument Serif** identity · **Archivo** UI · **IBM Plex Mono** every number, tabular. No neon, no card suits, no emoji, no exclamation marks.

---

## 7. Desktop reconsiderations in force

Persistent side panels instead of sheets · hover states exist but nothing depends on them · real tables are appropriate for tournaments and superlatives (the stacked-card patterns stay on file for the mobile pass) · generous but normal desktop hit areas · type scale revisited upward (board body 13–15 px, room names 17–24 px serif, section heads 30 px serif) · content max ~1240 px, map full-bleed.

---

## 8. Data

Every figure **on the board** is still a researched placeholder. But as of 2026-08-03 there is now a **real data layer behind it**, and the two do not agree about how much there is to show.

The roster is **17 permanent valley rooms**, reconciled against Vegas Advantage's open-rooms list. **WSOP·Paris is modelled, not deleted:** `seasonal: true`, excluded from the default roster, the pin set and every match count, and shown when the series is live (late May – mid July).

**What is actually in the database** (`supabase/seed.sql`, all of it candidate data — `source_url` and `fetched_at` set, `verified_at` NULL on every row):

| | seeded |
|---|---|
| rooms | 17 / 17, each with lat/lon, area, hours |
| cash games | 75 across all 17 rooms |
| amenity types | 12 — the panel's non-GAMES checkboxes exactly |
| room ↔ amenity links | **8, across 6 rooms** |
| verified anything | **0** |

**THE DESIGN AND THE DATA DISAGREE ON AMENITY DENSITY, AND THE DATA IS RIGHT.** The landing-map mock gives each room six to ten amenity keys (Red Rock carries ten). Published sources support **0–2 per room**, and **11 of 17 rooms have none at all**. Seven of the twelve filters — `tableside`, `kitchen24`, `freeself`, `freevalet`, `massage`, `checkcash`, `phonein` — currently match **zero** rooms. The AMENITIES block on the detail card and the filter panel's match counts were both designed against a density that published sources do not provide. This is a design consequence, not only a seeding shortfall — see decisions.

**Games are not amenity types.** Which games a room spreads lives in `cash_games.game`; the GAMES group queries it directly. `amenity_types` covers only the other four groups. Two records of the same fact drift.

Three things the seeding pass proved about the schema, all now fixed: fixed-limit games had no home (`small_bet`/`big_bet` added — 27 of 75 games use them), rake could not be recorded as unknown (`rake_type` nullable; Horseshoe publishes no figure at all), and rake needed its own receipt (`rake_source_url`, because The Orleans publishes stakes on Boyd's site and its cap only on a third party).

---

## 10. The design system — rebuilt this pass

The token file and `SKILL.md` are what the build actually consumes, so they are now the locked system rather than the mobile one.

**Tokens** (`--cid-*`, replacing `--pm-*`): `colors.css` is ink + aubergine + teal with a light mode and a single dim token; `typography.css` is the desktop scale (52 statement / 44 h1 / 28 h2 / 21 room name, mono at 15 rank / 13 num / 11 tag / 9.5 label); `layout.css` carries the page frame (1240 / 20 / 64 / 302 / 760 / 56) **and the table grid contract**; `motion.css` carries the knock keyframes. Verified resolving: `--cid-value → #4FBFAE`, `--cid-rank → 600 15px/1 IBM Plex Mono`.

**Components** — the mobile-only set is deleted (`BrassAction`, `ReportControl`, `BottomNav`, `AreaFilter`, `PromoPanel`, `SourceStrip`, `FreshnessBadge`, `RoomCard`, `FilterChip`). What replaces it matches what shipped: `AccentAction` + `QuietAction` · `RankCell`, `UnverifiedFlag`, `ExclusionNote`, `EditorialRead`, `DataRow` · `SortableHead` + the `TableGrid` contract · `ClusterPin`, `RoomPin`, `GlancePopup`, `FilterPanel` · `CompareTray`, `CompareChip` · `KnockMark` · `SiteHeader`.

**The prompt files carry the rules, not just the pixels** — every bug this project found is written where the next person will hit it: `minmax(0,fr)` and `border-box` in `TableGrid`, the sort-metric rule in `SortableHead`, the URL-before-localStorage ordering in `CompareTray`, the three cluster states in `ClusterPin`, and the "only where judgement fills a gap" test in `EditorialRead`.

**`readme.md` and `SKILL.md` describe the product as it now is** — desktop-first, aubergine, 17 rooms, no crowd reporting, no waitlist.

---

## 9. Known limitations

1. All numbers **on the comps** are placeholders. The database behind them is real but **entirely unverified** (`verified_at` NULL on every row), so it is displayable — tilde'd, dotted, never ranked — and nothing in it may be ranked or presented as fact until a floor visit confirms it. A "best rake" column cannot honestly be computed from this dataset today.
8. **Dress code and drinks are 0/17 and will stay there.** Not a research gap — no room publishes either. Those two fields are permanently in-person or permanently empty, so the first-timer strip may not ship in v1.
9. **Five properties block automated fetching entirely** — all four MGM rooms (ARIA, Bellagio, MGM Grand, Mandalay Bay) plus Golden Nugget. That is half the Strip roster, and it means no tier-1 scraper will ever serve them; they are permanently Tier 2.
2. ~~Map modules need re-skinning~~ — **done.** `checkitdown-map-3d.html` carries the locked aubergine palette, cluster pins and the building dim. `poker-map-tier-a.html` remains as the Tier A fallback and is not wired into the desktop landing map.
3. ~~Tokens and components are still the mobile felt/brass system~~ — **done.** `tokens/` and `components/` are the Check It Down system as of this pass; see §10.
4. The board's map band is a **treatment mock**, not the live 3D module; it shows pins, popup, side panel and dim behaviour in each palette. The real map exists as its own file.
5. Only Strip-area geometry is extruded in Tier B; surrounding blocks stay flat (Overpass footprints unreachable from this environment).
6. ~~No desktop layout exists yet~~ — **four desktop surfaces are built** (map, superlatives, tournaments, promos) plus the direction board.
7. The parked mobile screens are stale in **scope**, not only palette — they are built around crowd reporting, wait times and a waitlist button, all out of v1. They are pattern reference for stacked cards and sheets, nothing more.

---

## 10. Decisions needed

The last three are **answered and folded into the spec above**: superlatives dim picks in place and keep true rank order (with true citywide ranks even when filtered) · an excluded unverified figure is named with its reason, never counted · tournaments ship as a sortable table with a routable `/tournaments/<slug>` detail and the dailies-PDF / series-transcription split intact.

### RULED 2026-08-03 — the amenity filter does not ship in v1; the amenity data does

**The problem was never density, it was that a dim renders an unknown as a negative.** A dim on that map *means* "this room does not have it". At current coverage it would actually mean "we have not checked" — tick Tableside food and fifteen rooms go dark, most of them rooms that probably do serve at the table. That is the one thing this product cannot do, and it would do it in its most visible interaction. Every other surface has an unknown state: tilde'd, dotted rule, never ranked, exclusion line naming the room and the reason. **The filter has no such state**, so it must not be pointed at data that is mostly unknown.

- **Hiding zero-coverage checkboxes: yes, but as a floor, not a fix.** A checkbox that can never match is broken rather than honest — but hiding the seven empties would still leave five filters dimming on 0–2 rows of evidence.
- **The filter panel ships with GAMES only.** 75 cash games across all 17 rooms is total coverage, so a non-match really is a non-match and the dim is a claim we can stand behind. The signature interaction survives; it filters on the axis where our data is complete.
- **Amenity data still ships** — on the room detail card, where each fact carries provenance and absence reads as absence-of-information. This is *not* parking it like Promos: Promos has nothing behind it, amenities have real sourced facts and a real home.
- **Trigger to switch a group on, per slug not someday:** a group appears when its slugs are answered for enough rooms that a dim is a claim we can stand behind. Amenity facts are not unavailable, they are **un-scrapable** — a person in the room knows all twelve in ninety seconds. This is the strongest argument yet for the floor-visit pass.

Implemented: `GROUPS` in `Check It Down - Landing Map.dc.html` now carries a `shipped` flag consumed by `GROUPS.filter(g => g.shipped)`. The four amenity groups remain in source, off, so they return per slug rather than being rebuilt. Verified that `checked` is never restored from URL or localStorage (only `compare` is), so no stale slug can filter behind a hidden group.

**Red Rock's "restroom within the poker room"** — dropped. The panel is authoritative; a 13th slug invented at seed time is the drift the GAMES ruling forbids.

### RULED 2026-08-03 — the honest state is a design deliverable, not a fallback

**1. AMENITIES empty state: ships, naming the reason.** "Not yet checked on site", with the correction link beside it. This is not damage control — it is the clearest statement of what makes the product different: PokerAtlas shows undated facts and lets you assume they are current; we show a **dated gap**. The correction link turns that gap into an input, and it doubles as a visible pipeline to-do.

**2. Just the Facts builds against the database, not the mock.** Verifying a subset first is the *launch* answer, not an alternative to building against real data now — the screen fills in as verification lands.

The consequence is the point: **building against real data stress-tests the honest state, which the mock never did.** The comps show a fully-populated, fully-verified table that will never exist on day one. With zero verified rows Just the Facts must still look **intentional** — and if it looks broken, that is a design flaw to fix now, because a partly-verified table is exactly what launch day looks like.

> **NEW DESIGN NEED — the three superlative cards need a designed zero-verified state.** LOWEST RAKE / BEST FOOD / MOST TABLES with nothing rankable can neither render blank nor show a placeholder winner. Same discipline as the exclusion line: say what is missing and why. This state **will exist in production**, so it must exist in the design.

**3. `area` ships as is — it is wayfinding, not a finding.** No editorial label: that label is for judgements dressed as findings, and applying it to a navigational bucket would over-apply the rule until it means nothing. `off_strip` and `locals` are **not** collapsed — the distinction is real, players make it constantly, and rake, comps and game quality genuinely differ. `area` is documented in the README as a **classification field, not a fact field**, in the same category as `slug`; disputed classifications go through the correction flow.

### Nothing is blocked

All three open calls from the data pass are ruled above. Step 3 — the Next.js
build — is unblocked and proceeds against the exported tokens and components
rather than new styling.

The one thing carried into that build as **design work, not plumbing**, is the
zero-verified state of the three superlative cards. It is not a fallback: on day
one it is the only state that exists.

Settled during the superlatives build, and now rules rather than choices:
1. Sort control sits **in the sticky table header**, next to the columns it sorts.
2. Rank is one mono `#n` column, no medals or badges.
3. **Rank is tied to the active sort and says so** — the header reads `# BY RAKE`, `# BY PARKING`, and the numbers re-render with the sort. There is no single canonical citywide rank on this table, so an unqualified "#1" would be ambiguous and would make the shortlist readout meaningless.
4. **Any column offered as a sort must have a real number behind it.** The freshness column shipped sorting on source-array position while relabelling itself `# BY FRESHNESS` — a claim two rows of the table falsified. Human-readable strings ("Yesterday", "3 days ago") are display only; the sortable truth is `verDays`, and a room with no confirmed value falls to the bottom ranked `—` exactly as an unverified rake does. Applies to every table in the product.
5. **A sort's direction is part of the claim.** Ranked-list captions say which end is best ("cheapest first", "deepest structure first") **and name the metric they actually rank on**, and the comparator has to agree — a caption describing a superseded formula is as false as an unsorted column, and on a screen that shows its working a reader will do the arithmetic — a negated comparator under an ascending caption is the same falsifiable claim as an unsorted column. Where two columns measure cost on one table they run the same direction.
6. **Teal stays on the true #1 even when the compare dim is on** and that row is not one of the picks. The picks are already distinguished by not being dimmed; a second "best of your picks" highlight would put two competing best-signals on one screen. Truth stays on the real leader; the dim does the personalising.
