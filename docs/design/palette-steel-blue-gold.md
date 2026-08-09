# CHECK IT DOWN — verification brief + tokens

Desktop-first web product mapping every poker room in the Las Vegas valley — games, rake, amenities, promos, tournaments — and ranking who's best at what. Independent of the casinos: every fact carries a source and a verified date. Mobile deferred but coming; no interaction may lack a touch equivalent.

Verify by probing the DOM and reading the numbers back. Do not eyeball.

## THE LAW — palette RULED 2026-08-09, do not re-argue

Blue is brand, base and surface, and carries the one filled action per screen with a 1px lit top edge. Nothing else is filled.

Gold is decorative and carries no data meaning — mark rings, header hairline, section rules, a card's top edge, the map's cage and road accents. Gold never fills a surface. Gold is never the sole carrier of anything a reader must not miss.

No data state is carried by colour. Verified is a mark and a date. The true #1 is weight, size and full-strength ink. Caution is rank position, weight and size. Unverified is #8FA2B8 + tilde + dotted rule.

No ochre, amber or red as caution — all three collide with the brand's own gold.

## Colour — tokens/colors.css (dark primary)

Ratios are measured, not intended.

| Token | Value | Measured |
|---|---|---|
| `--cid-ink-900/800/700/600/500` | `#070A0E` · `#0B0F14` page · `#121820` surface · `#171F29` head · `#1E2733` | — |
| `--cid-accent-900/700/600` | `#12365F` · `#1E4E86` the one filled action · `#245C9C` hover | label on fill 7.50:1 |
| `--cid-accent-500` | `#5B8FD1` mark solid | 5.35:1 |
| `--cid-accent-300` | `#7FB0E8` accent type + 1px lit edge | 7.88:1 on surface · 3.73:1 on fill |
| `--cid-accent-200` | `#A6CAF3` link hover | — |
| `--cid-accent-wash` / `-line` | `rgba(30,78,134,.26)` · `rgba(127,176,232,.34)` | — |
| `--cid-paper` | `#EEF2F7` | 15.87:1 surface · 17.10:1 page |
| `--cid-text-2` / `-3` / `--cid-dim` | .82 · .72 · .58 paper | 10.91 · 8.65 · 6.02:1 (the floor) |
| `--cid-disabled` | .38 paper — non-text markers only | — |
| `--cid-line-1/2/3` · `--cid-fill-1/2` | .09 / .14 / .28 · .04 / .08 | — |
| `--cid-gold` | `#C9A24A` decorative only | 8.01 page · 7.43 surface · 6.92 head |
| `--cid-gold-line` | `#A8853C` hairlines | 5.17:1 |
| `--cid-gold-rule` | `rgba(201,162,74,.34)` section rules, card top edges | — |
| `--cid-value` | `var(--cid-text)` — deprecated in place, was teal. Renders as emphasis, never a colour claim. Do not point at gold. | — |
| `--cid-unverified` | `#8FA2B8` | 6.82 surface · 7.35 page |
| `--cid-unverified-rule` | `rgba(143,162,184,.5)` dotted | — |
| `--cid-dim-row` | 0.42 — deprecated for text rows (see open defect); valid for dimmed pins | 3.76:1 |
| `--cid-pin` / `-dim` / `-cluster-partial` | accent-500 (selection stays blue) · .26 paper · accent-300 | — |
| `--cid-scrim` | `rgba(5,8,11,.68)` | — |
| NEW `--cid-rank-lead` / `-weight` / `-size` | `var(--cid-text)` · 700 · 15px | 15.87:1 |
| NEW `--cid-rank-peer` / `-weight` / `-size` | `var(--cid-text-3)` · 500 · 13px | 8.65:1 |
| NEW `--cid-row-dim-text` / `-meta` / `-lead` | `var(--cid-dim)` · .5 paper · `var(--cid-text-2)` | 6.02 · — · 10.91:1 |

Light theme derived and measured this pass (not carried over): page `#F1F3F6`, surface `#FFFFFF`, text `#0C1219` (18.81:1), dim .62 (5.28:1), accent `#1B5A9E` (6.99:1, white label 6.99:1), unverified `#55637A` (6.08:1), gold `#7A5C1C` (6.22:1). Two things don't survive the inversion: the lit edge can't read on a mid-dark fill (2.05:1) so light uses NEW `--cid-action-underline`: `#0B2E55` beneath the button (13.67:1); and dark-mode `#C9A24A` measures 1.90:1 on white — never use it there.

## Type — tokens/typography.css

`--cid-font-display` Instrument Serif · `--cid-font-ui` Archivo · `--cid-font-mono` IBM Plex Mono. Scale: `--cid-statement` 52px (one per page, max) · `--cid-h1` 44 · `--cid-h2` 28 · `--cid-room-name` 21 · `--cid-lede` 16 · `--cid-body` 13.5 · `--cid-caption` 12.5. Mono: `--cid-num` 13 · `--cid-num-lg` 17 · `--cid-rank` 600/15 · `--cid-tag` 11 · `--cid-label` 600/9.5. Tracking `--cid-track-label` .18em · `-nav` .16 · `-action` .15. `--cid-tabular`: tabular-nums on every number.

## Layout — tokens/layout.css

Space 4/6/9/12/14/20/26/34/52 · `--cid-page-max` 1240 · `--cid-gutter` 20 · `--cid-header-h` 64 · `--cid-panel-w` 302 · `--cid-measure` 760 · `--cid-target` 44px, desktop included · `--cid-row-h` 56 · `--cid-tray-w/h` 236/190. Radius 3/4, pill for pins only. `--cid-table-cols` — every fr track is `minmax(0,…)`, or long cells push the page past the viewport.

## Motion — tokens/motion.css

`--cid-ease` · `--cid-ease-knock` · `--cid-dur-fast` .18s · `--cid-dur` .26s · `--cid-knock` 3.4s. The mark knocks twice (knockR1, knockR2 at 17%, knockTap), once on load and replayed on hover, never looping. `prefers-reduced-motion` freezes it with one static ring at .62 — never a bare dot.

## Product-wide rules, all earned by bugs

Any column offered as a sort must have a real number behind it — strings are display only.

A hit area and a text decoration cannot share an element; 44px wrapper, rule on an inner span.

A sort's direction and metric are part of its claim — the caption names what it ranks on and the comparator must agree.

Auditing contrast: composite alpha down the ancestor chain and multiply effective opacity — ignoring alpha reported 25 false failures, ignoring opacity hid 12 real ones.

When a token changes mid-pass, re-read every sentence describing it.

## Built surfaces — invariants to re-check

All four still render aubergine on screen; the token swap has not been applied yet.

**Landing map** — entry z11 · 0 rooms outside crop · 8 pins for 17 rooms · 0 overlaps; every reset routes through the fit. Filter dims buildings and pins, never removes. Clusters 9 / 1/9 / 0/9. Compare: chip at one room, tray at two, no hard cap, display soft-caps at 4. URL is source of truth; localStorage read only when the param is absent; noindex,follow on any non-empty set.

**Just the facts** — rank tied to the active sort and says so; freshness sorts on verDays. Compare never reorders; "only my rooms" keeps true citywide ranks. Excluded rooms named with the reason, not counted.

**Tournaments** — groups default; any non-time sort flattens to 0 heads with a banner. PACE = stack × level ÷ 60. OUR READ editorial, unsortable, uncoloured. Detail routable at `/tournaments/<slug>`.

**Promos** — honest not-built-yet page, no fabricated figures.

**Blue and Gold board** — 1a/1b/1c on one row (tops 217, canvas 2108px); turn 2 2a/2b proves the #1 treatment and the gold placements.

Every screen: `body.scrollWidth` ≤ 924 · 0 text nodes below 4.5:1 (measuring opacity too) · exactly one filled action · no console output.

Data caveat: every rake, drop, comp rate, table count, buy-in, guarantee and structure is a researched placeholder. 17 permanent valley rooms; WSOP·Paris is seasonal: true, not deleted.

## Decisions needed

**Compare-dim.** `--cid-dim-row: 0.42` puts a dimmed row below AA — lead 3.76:1, peers 2.56:1 — because opacity scales the row against its backdrop. No palette fixes it. Alternative measured: colour step, lead 10.92:1, peers 6.01:1, same recession. Decide for me: the colour step.

**Apply the token swap.** Order: colors.css (done) → four surfaces → checkitdown-map-3d.html, whose dim/lit/cluster ladder needs re-measuring, not recolouring → component prompt files → readme/SKILL. Default: that order, one pass, re-run every invariant after.

**Map's decorative gold** — cage and road accents stay; selected pin stays blue. Default: as stated; gold never marks selection or hover.


---
*(Erratum, 2026-08-09, found during the swap: dark-mode #C9A24A on white measures **2.40:1**, not the 1.90 printed above. The instruction is unaffected — it must still never appear on white. Recorded here rather than edited in place: this document is the record of what Design delivered.)*
