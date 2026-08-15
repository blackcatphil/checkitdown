# Consuming this bundle

The README beside this file is the designer's. It is vendored: cite it,
do not edit it. These are our rules for building against it.

## The bundle is complete as of 2026-08-15

`Growth Engine.dc.html` (the markup and its logic class), `support.js`
(the prototype runtime — reference only, never ported), the six
screenshots, and the Modernist `_ds/`.

It took three attempts to arrive. Twice the design tool reported writing
it here and had written to its own workspace instead; the zips that
reached the machine held `_ds/` and nothing else. The console built
between 2026-08-12 and 08-15 was therefore built from a PROSE
ENUMERATION of the cells, not from this markup — so anything the design
contains that the enumeration missed is missing from the build, and the
geometry is approximate rather than matched.

## Rules

- **Scoped to `/admin/*` only.** Never merge these tokens into
  `app/globals.css`. Two token systems in one repo is how a retired
  palette survives on the icons.
- **Take every value from `styles.css`.** Do not re-derive a hex, a size
  or a rule from prose, including from any brief. The console's copy is
  gated against this file by `lib/modernist.test.mjs`.
- **No data state is carried by colour**, whatever the system allows.
  The accent may show movement against a target or mark a control.
  Verified, unverified, absent and the three absence states may not.
- **Deliberate divergences are two-sided.** Each is recorded with both
  what we hold and what the system holds, so that when the system
  changes the entry fails and tells us to delete the fork.

## Known contradiction in the system itself

`readme.md` says labels sit flush left in three places, including "never
centered" (lines 3, 14, 51). `styles.css:115` centers them. Line 10 of
the same readme warns to keep the guidance in step "so they don't drift
from what the CSS actually does". We follow the prose and override
`.btn`; whoever regenerates Modernist should fix `theme.json`.

## Known divergences — colour carrying data state

The prototype paints four data states with the accent. All four are **refused**.
Each entry records what the design holds and what we hold, so that if the design
is regenerated without the colour, the entry stops matching and tells us to
delete the fork rather than carry it forever.

| # | Design | Where | We hold |
|---|---|---|---|
| 1 | Fact-coverage bar fills `--color-accent` under 70%, neutral otherwise (`covC`) | `Growth Engine.dc.html:775`, `README.md:164` | One neutral bar. Coverage is `FILLED n/13` plus the names of the missing fields — a count and a list, legible in greyscale. |
| 2 | Verified age turns `--color-accent-700` past 48h (`hrsC`) | `Growth Engine.dc.html:777`, `README.md:164` | Age as text. Staleness is the number, not the hue. |
| 3 | Status tag by freshness: `VERIFIED` / `AGEING` / `STALE` → `tag-neutral` / `tag-accent-2` / `tag-outline` | `Growth Engine.dc.html:779`, `README.md:164` | No status column. Verified/unverified by colour is the case §6 names outright, and three tag styles for three freshness bands is that rule broken three ways. |
| 4 | Loop gain in `--color-accent` when ≥ 1.15, `--color-neutral-600` below (`gainColor`) | `Growth Engine.dc.html:848`, `README.md:135` | One weight for every gain. **A threshold is a state, not a movement** — the accent is licensed for movement against a target, and "is this number above 1.15" is a category, not a direction. |

**Permitted, and unchanged from the design:**

- Delta direction — `--color-accent-700` when moving the right way, `--color-neutral-700`
  when not (`Growth Engine.dc.html:550,554`). This is movement against a target,
  which the accent rule allows.
- The selected week's bar in the chart (`Growth Engine.dc.html:562`). This marks
  a control — which week you are looking at — not a property of the data.

⚠️ The prototype has **no absence states**. Every cell holds a number because
every number is invented (`README.md:35`). So the markup gives no guidance on
the one thing this console exists to do, and any cell ported from it assumes a
number is present. Port geometry; never port a cell.
