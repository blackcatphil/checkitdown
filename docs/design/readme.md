# CHECK IT DOWN — design system

Desktop-first web product that maps **every poker room in the Las Vegas valley** — cash games, rake, amenities, promotions and tournaments — and ranks who is best at what. Independent of the casinos it covers. Mobile is deferred but coming, so no interaction may lack a touch equivalent.

The name is the promise: a check in the poker sense, and a claim that every fact has been checked. If a screen cannot honour that, it says so on its face.

## The two rules that override everything

**1. No data state is carried by colour.** Gold is decorative and carries **no data meaning** — mark rings, the header hairline, section rules, a card's top edge, the map's cage. Gold never fills a surface and is never the sole carrier of anything a reader must not miss. **Verified is a mark and a date.** The true #1 is weight, size and full-strength ink. Caution is rank position, weight and size — never ochre, amber or red, all three of which collide with the brand's own gold.

*This rule replaced "no gold anywhere" on 2026-08-09.* The original ban was about not reading as a casino; the palette that answered it (aubergine on ink) was retired for steel blue and a disciplined decorative gold. What survives intact is the reason behind the ban — a colour must never be the thing a reader has to notice — and it is now stated as the rule rather than as a banned hue.

**2. Every number carries provenance.** Verified with a date, or tilde'd and marked unverified in `#8FA2B8` with a dotted rule. There is no third option, and nothing is ever stated as fact without a real source behind it. An unverified figure is *shown* — never hidden, never quietly rounded — but it cannot win a ranking.

## Index

| Path | What |
|---|---|
| `styles.css` | The one file consumers link. `@import`s everything below. |
| `tokens/fonts.css` | Instrument Serif, Archivo, IBM Plex Mono. |
| `tokens/colors.css` | ⚠️ **Stale — still the retired aubergine palette.** The canonical colour source is [`app/styles/tokens/colors.css`](../../app/styles/tokens/colors.css) in the app, which the manifest, the map style and the palette gate all read from. |
| `tokens/typography.css` | Three families, desktop scale, tracking, tabular numerals. |
| `tokens/layout.css` | Spacing, page frame, targets, the table grid contract. |
| `tokens/motion.css` | The knock keyframes and easings. |
| `components/actions/` | `AccentAction`, `QuietAction` |
| `components/data/` | `RankCell`, `UnverifiedFlag`, `ExclusionNote`, `EditorialRead`, `DataRow` |
| `components/tables/` | `SortableHead`, plus the `TableGrid` layout contract |
| `components/map/` | `ClusterPin`, `RoomPin`, `GlancePopup`, `FilterPanel` |
| `components/compare/` | `CompareTray`, `CompareChip` |
| `components/brand/` | `KnockMark` |
| `components/navigation/` | `SiteHeader` |
| `guidelines/` | Specimen cards — colour, type, spacing, targets, motion, radius. |

Designs are authored with **inline styles**. The token files are the handoff contract for the build and the reference the guideline cards render from — not a stylesheet the designs import.

## Built surfaces

| File | What |
|---|---|
| `Check It Down - Landing Map.dc.html` | Landing map, 302px filter panel, glance popup, routable room detail (modal + standalone page), compare tray. |
| `Check It Down - Just the Facts.dc.html` | The superlatives table — cross-room ranking with re-qualifying ranks. |
| `Check It Down - Tournaments.dc.html` | Every daily and series event, buy-in split out, sticky time groups. |
| `Check It Down - Promos.dc.html` | Honest not-built-yet page: what will be tracked, why it is empty, what unblocks it. |
| `checkitdown-map-3d.html` | Map module — Leaflet + OSM, 60° tilt, extruded massing, cluster pins. |
| `Check It Down - Palette and Logo.dc.html` | Direction board: six palette comps, seven logo studies. |

Ten mobile screens from the earlier phone-first phase are parked in the project as **pattern reference only** — stacked cards, sheets, bottom nav. They are stale in *scope*, not just palette: they were built around crowd reporting, wait times and a waitlist button, all of which are out of v1. When mobile comes, it is a fresh responsive pass from the desktop surfaces, not a re-skin of a different product.

## Visual direction

**Steel blue on ink, with decorative gold.** Ruled 2026-08-09; see [`palette-steel-blue-gold.md`](palette-steel-blue-gold.md) for the full law and the measured ratios.

Blue is brand, base and surface, and carries the one filled action per screen: `#1E4E86`, hover `#245C9C`, with a 1px `#7FB0E8` lit top edge. Accent type and that edge are `#7FB0E8`; the map pin and the mark solid are `#5B8FD1`. Page `#0B0F14`, surface `#121820`, head `#171F29`, paper `#EEF2F7`.

Blue needs a pair of values for the same reason the old purple did — a saturated surface for fills and a lighter tint for type, because a dark accent set as text on ink fails contrast. What changed is that **value no longer has a colour at all**: `--cid-value` resolves to full-strength ink and renders as emphasis, because a teal "good" marker was a data state carried by hue and rule 1 now forbids that outright.

**The gold ramp, canonical from the app.** `#8A6D1F` · `#C9A227` (`--cid-gold`) · `#E3C567` · `#F0DC9C`, wash `rgba(201,162,39,.14)`, hairline `rgba(227,197,103,.34)`. Gold appears on rules, hairlines, eyebrows and mark rings — and on nothing that carries a claim. Unverified stays neutral at `#8FA2B8`: an ochre "not yet confirmed" would sit one step from the decorative gold and one step from a warning, which is the worst place for a state to live.

**Type.** Instrument Serif for page titles and room names (it has no bold — do not fake one). Archivo for interface copy and prose at a 760px measure. IBM Plex Mono for every number and label, always tabular. One statement-size line per page, maximum.

**The mark** is two knuckles on the table with a ring spreading from the leading one. Not a checkmark tick, no card suits, no chips. It knocks twice on arrival and again on hover, never on a loop — a permanently ticking logo competes with live data. At rest a static ring holds it.

## Content fundamentals

- **Voice:** a sharp local who plays. Plain, factual, never hyped. "10% to $3 · $1 drop · 35 tables" beats "Best value in town".
- **Person:** talk to the player as *you*; the product never says *I*.
- **Casing:** room names and headlines in sentence case with real punctuation. Mono labels in caps with wide tracking (`VERIFIED DAILY`, `EDITORIAL · NOT SORTABLE`). Actions in caps (`ADD TO COMPARE`).
- **Time:** relative and honest — "verified 2 days ago", "fetched 2 days ago". Data refreshes daily, so "today" is healthy, not a warning.
- **Unbuilt surfaces admit it, and say what they will do:** "City-wide promotion tracking — not built yet", followed by the scope and what unblocks it. Never "Coming soon!".
- **Show the working.** Where a figure is computed, the method is on screen and names its convention: fee as a share of the *total* buy-in, and what the same number would read against the prize pool.
- **No emoji. No exclamation marks in UI copy.**

## Ranking rules

These are the ones that cost the most when broken. Each was earned by a shipped bug.

1. **Any column offered as a sort must have a number behind it.** Strings are display only — `"2 DAYS AGO"` sorts alphabetically and puts 10 days before 2.
2. **A sort's direction and metric are part of its claim.** The caption names what it ranks on and which end is best, and the comparator must agree. A caption describing a superseded formula is as false as an unsorted column.
3. **Rank belongs to a sort, not to a room.** The column head re-qualifies (`# BY RAKE`) and the numbers re-render with it.
4. **Never renumber a filtered view.** A shortlist reads `#2, #4, #11` — the citywide positions are the point.
5. **Teal marks the true #1 even when that row is dimmed.** Personalisation is the dim; best-in-city is not personal.
6. **Name the excluded room and the reason, never a count.** A hedge becomes a correction prompt.
7. **Editorial judgement only where it fills a real gap** — whether a daily tournament actually fires is unpublished, so judging it is the only way to have it. Rake and parking are published; judgement there would dilute the sourced table.

## Layout invariants

- Page 1240px max, 20px gutters, 64px sticky header, 302px map panel, 56px table rows, 44px minimum targets on desktop too.
- **Every grid `fr` track is `minmax(0, Nfr)`** and the page is `border-box`. Without both, one long room name or a padded full-width container puts a horizontal scrollbar on the page.
- **One dim token: `rgba(242,244,246,.58)`** ≈ 5.3:1. Anything dimmer is a non-text marker. Target zero text nodes below 4.5:1 and verify by probing computed styles against real backdrops, not by eye.
- **Filtering dims, never removes.** A room that vanishes reads as "we don't have it" rather than "it doesn't match".
- **URL is the source of truth** for shareable state; localStorage is read only when the URL carries no param. Any personalised state sets `robots: noindex,follow` with a canonical back to the clean path.

## Caveats

- Every rake, drop, comp rate, table count, buy-in, guarantee, structure, parking and food string in the built surfaces is a **researched placeholder**, not a live feed. Real ingestion replaces all of it before anything goes in front of a user; the provenance system exists so that swap is visible when it happens.
- The roster is **17 permanent valley rooms**. WSOP·Paris is carried as `seasonal: true` — off the roster, pins and counts by default, restored by a panel toggle.
- No brand assets, logo files or font binaries were provided. The mark is original to this system; the three families load from Google Fonts.
