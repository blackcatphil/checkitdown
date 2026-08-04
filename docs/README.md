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

Baseline (re-counted 2026-08-04, not carried forward): 15 tables · 1 view ·
10 enums · **225 columns** · 41 indexes · **3 check constraints** · 4 triggers ·
15/15 tables RLS-enabled · 12 policies. The earlier figures here said 219
columns and 2 checks — stale from before `small_bet`/`big_bet`, the three
`rake_*` provenance columns, `closed_on` and `closure_is_dated`. Re-count rather
than copy; a baseline nobody re-derives is a claim, not a measurement.

### An observation carries when it was made

**Anything that changed underneath an observation since makes it unverified
again — the same rule this product applies to rooms, applied to us.**

"A number copied forward is a claim, not a measurement" is one instance of this.
The general case is the dominant failure mode of this build, and every example
is the same shape — a claim asserted without checking whether its subject had
moved since it was observed:

- git state read once and reported a turn later, while commits landed in between
- a scheduled wake-up that fired after the work it was waiting for was done
- the schema baseline (219 columns) carried forward past four migrations
- "map re-skinning — done" while the gradients were still felt green
- `is_seasonal` "off the roster by default" with no read path enforcing it
- a visual comparison of two zoom levels, made against a rendering that had
  since been replaced
- geometry reported as measured, correct, and **never actually looked at**

That last one is the rule applied *correctly*: stating the limit of the evidence
instead of asserting past it. That is the standard — not never being stale, but
knowing when your evidence has a timestamp and saying so.

### Untagged buildings render as FLAT FOOTPRINTS, never guessed volumes

> **UN-SUPERSEDED 2026-08-04, and worth reading as a pair.** It was briefly
> marked moot because vector tiles expose only `render_height`, into which
> OpenMapTiles has already merged `height=` and `building:levels` — there was no
> tagged/untagged distinction left to act on, so the rule had nothing to
> implement against.
>
> **Reverting to extruding only our own 17 casinos brings it back**, because it
> brings back control of the data. That is the argument for the reversion, and it
> was only visible after trying the other way: extruding from tiles meant
> accepting `render_height`, which **is** the MGM-Grand-as-a-two-storey-box
> problem. With our own polygons, the podium problem stops being a documented
> wart and becomes a thing we decide.
>
> Sourcing heights for 1,283 corridor buildings was never realistic — which is
> precisely why we took what the tiles gave. Seventeen is tractable.

A footprint says *"there is a building here and we do not know its height."* A
default extrusion says *"this building is 12 m tall"* — a claim nobody made.
That is the inflation path again, which was deleted once already for fabricating
how big a building is, on the surface where this product's honesty is most
visible.

**This is `verified_at` applied to geometry.** The skyline ends up composed
entirely of heights someone actually recorded, and the flat ground plane is
honest rather than a rendering gap. It also happens to be closer to the truth:
the untagged rooms are mostly genuinely low-rise — Red Rock, Santa Fe, Boulder
Station really are single-storey locals casinos, so a flat footprint is nearer
reality than any guessed tower would be.

### Mis-tagged is worse than untagged: it renders WRONG, not missing

The flat-footprint rule handles buildings with no height. It does **not** handle
buildings with a *bad* height, and that is the more dangerous case.

A building rendering flat says *"we do not know."* A building rendering at 14 m
says *"this is 14 m tall"* — drawn with exactly the same visual authority as
ARIA's correct 183 m, and **nobody said it**. Measured in the Strip corridor:

- **72% of tagged buildings (222 of 308) are `building:levels` only**, no `height=`
- **40 named buildings are levels-only and ≤3 storeys** — including
  **"Hotel MGM Grand Las Vegas" at 2 storeys**, New York New York at 2,
  Park MGM at 3, Hard Rock at 1. Those are thirty-storey towers.
- **Zero buildings in the corridor carry `building:part`**, the OSM pattern that
  distinguishes podium from tower. **So it cannot be detected from the tiles at
  all** — a short levels tag on a resort is indistinguishable from a genuinely
  short building.

This is the same failure as the "nearest building" bug that gave ARIA 20 m off
its podium — except baked into the source data rather than our query, so the
tallest-within-130m fix that saved the room table cannot save the map.

It also weakens the headline: **"24% have a usable height" silently includes
some that are usable AND WRONG.**

### Checking the output cannot catch an error whose output is plausible

Only checking the **method** can. This is the general case that most of this
build's real defects turn out to be instances of:

| defect | why output-checking missed it |
|---|---|
| RLS policies inert without GRANTs | schema looked flawless — 15/15 RLS, 12 policies, no errors |
| Westgate cited the wrong page | the FK was valid and nothing was orphaned |
| `winner={null}` hardcoded | every test passed; the zero state was correct |
| Mandalay Bay's height off the wrong tower | **148 m instead of 146 m — the number looks right** |

Mandalay Bay is the clearest: "W Las Vegas" 148 m sits beside "Mandalay Bay
Resort & Casino" 146 m, so tallest-within-130m picked the neighbouring tower and
produced a figure nobody would ever query. **It would have survived forever.**
It was not found by noticing something wrong — it was found by *changing how the
question was asked*, from "which building is nearest" to "which building is
named this property".

**A later instance, same shape:** the `height=`-only rule was measured, argued
and ruled on for hours — all of it correct about OSM, none of it checkable
against the renderer until someone read the tile feature properties. The output
of the reasoning was sound; the method never asked what the tiles actually
expose. One `Object.keys(properties)` settled it.

**And the same schema decision closes something else:** the building layer
carries **no `name` property**, so per-building identification from tiles alone
is unavailable. That closes the one future case we had noted for building-to-room
mapping — highlighting a selected room's own mass in 3D. Recorded so it is not
rediscovered as a bug.

So when a result looks right, that is not evidence. Ask what the method cannot
distinguish: proximity cannot express "belongs to"; a valid FK cannot express
"supports this claim"; a passing test cannot express "the branch was reachable".

### When scoping something down, the work is REMOVING the broad path

Adding the narrow one is the easy half and the half that feels like the fix.

The spike highlighted **every building** on hover after the room-scoped
highlight was added — because the generic tile-layer handlers were never
removed. Both paths were live, both were individually correct, and
`room-fill` worked exactly as written. **The symptom was the old behaviour still
running, not the new one failing**, which is why reading the new code looked
right.

It is a sibling of the plausible-output class: nothing threw, nothing looked
broken in isolation, and **no test would have caught it**, because both
behaviours were intended — at different times.

*Corollary 1 — dead code left merely uncalled is the hazard deferred.*
`setHover()` was the removed path's driver; leaving it in place would have
reintroduced the bug the moment someone wired it back up. Delete it, or make it
unmistakably dead.

*Corollary 2 — check the comments, because **nothing ever fails when a comment
goes wrong**.* The comment on `a2b` still described the hover behaviour one
commit after that behaviour was removed. Code has a compiler, a linter and a
test suite arguing with it; a comment has nothing, so it is the part of a
codebase most exposed to going stale and the least likely to announce it.

*Corollary 3 — a check must show WHAT IT SAW, not only its verdict.* The first
CI run captured each suite's output into a variable and never echoed it, so when
the assertion failed the log showed the complaint and not the evidence. **A
failing check without evidence costs more than no check**, because it consumes
the time it was meant to save. Same lesson as the spike's inventory panel,
arriving in CI.

*Corollary 3b — red is not enough; it must be red FOR THE RIGHT REASON, and the
practical form is: check WHICH ASSERTION caught it, not just that CI went red.* All
three CI self-tests failed at the correct step. But the hardcoded
`winner={null}` — the original bug — was caught only **incidentally**, by the
sort-caption assertion, because the caption renders inside the winner branch.
The ZERO, ONE and THREE scenarios all passed with LOWEST RAKE permanently empty:
**the suite never asserted that a card shows its winner.** Checking *which* step
failed proved the gate; checking *which assertion* failed exposed a hole in it.
Direct assertions added, verified to fail on the regression.

*Corollary 3e — do not change the artifact under inspection.* A review of a
moving target is not a review. This is the same family as a visual comparison
made against a rendering that had since been replaced — except caught
prospectively rather than discovered afterwards. If a change would improve the
thing being looked at, it waits until the looking is done.

*Corollary 3c — when two checkers disagree, the one with the DEEPER MODEL wins.*
ESLint reported `total` unused; TypeScript found three readers. `no-unused-vars`
works from syntax and cannot see a type-only or indirect reader; the type checker
works from semantics. Removing it on the linter's word broke the build. The fix
is not "trust TypeScript" as a slogan — it is to ask **what each tool can
actually see** before believing the one that is easier to run. A comment at the
site is the right artifact, because the next person meets the same disagreement.

*Corollary 3d — when a COMPUTED figure and an OBSERVED one disagree and you know
why, the observation wins and the computation gets a note saying what it cannot
model.* A flat-viewport calculation put 5 rooms in the Strip landing frame; the
browser showed 8, because pitch extends the visible ground toward the horizon —
which the calculation does not model. **The tidier number is the tempting one**,
and it was wrong. Record the observation, and record what the model omits so the
gap is not rediscovered as a discrepancy.

*Corollary 4 — test the GUARD, not just the thing guarded.* That same step was
written to catch "a suite that ran nothing", and it could never pass: it grepped
for `# pass` where Node prints `ℹ pass`. The suite had been tested; the assertion
about the suite never had. One level above "a test that has never failed has not
been tested".

*Corollary 5 — two runs that can disagree are a flake generator, not redundancy.*
The first version ran each suite twice, once for the exit code and once to grep.
Each gate now runs once, tees to a log, and asserts against that.

*Corollary 6 — a suite can be correct by accident of its ENVIRONMENT.*
`test:mixed` mutates the database then reads rendered output. That premise holds
under `next dev`, which re-renders every request, and fails under `next start`,
which serves a build-time snapshot for `revalidate = 300`. Locally it passed for
five months' worth of reasons that were never about the code. **Note the product
consequence, separate from CI: a verified room keeps showing UNVERIFIED for up to
five minutes after the fact changes.**

*Corollary 7 — a 200 checks the TRANSPORT, not the CONTENT.* Removing
`setHover()` left orphaned statements outside any function; the JS was broken
and the page still served **200**. Checking the parse rather than the status code
is the same move as checking whether a source *supports* a claim rather than
whether the FK resolves.

**Swept the app for the same shape (2026-08-04) — all clean, and the reasons
differ, which is the useful part:**

| narrowing | broad path |
|---|---|
| amenity groups gated to GAMES | unreachable — `checked` is never restored from URL or storage, so a gated slug cannot arrive |
| Mixed games gated out | unreachable — `toggle()` only fires from a rendered button |
| 3D narrowed to z ≥ 14 | **deleted**, not bypassed — 0 references to the inflation path remain |
| pins narrowed to a dot in 3D | a switch, not an accumulation — one class or the other |
| `available` filter on amenities | filtered inside `amenityLabel()` and `present`, so no caller can skip it |

### Put the narrowing INSIDE the helper every caller must pass through

So scoping down cannot be forgotten at a call site. **Third instance of "make it
impossible rather than memorable"**, after `SortSpec` typing `value` as
`number | null` (a string sort is a compile error) and the fetch helper that
throws on an empty token rather than returning `''`.

**The two "unreachable" rows above have now been hardened**, because
*unreachable* is not *impossible*. Both held only by accident of elsewhere —
"a gated key cannot reach `checked`, because `checked` is never restored from
the URL or storage." That is the `is_seasonal` shape: a rule resting on a fact
about a different file, which fails **silently** the day someone adds shareable
filter state, with old behaviour returning as the only symptom.

`lib/game-filter.ts` now owns the gate, the visible checkbox list and the
matcher, so a key with no coverage is dropped *inside* the one function every
caller goes through — and `dropped` is returned rather than swallowed, because a
silently discarded filter key is the same class of thing as a silently excluded
room. `lib/game-filter.test.mjs` pins it (`npm run test:unit`), including the
case the old arrangement could not survive: a stale key arriving from a shared
URL. Verified to fail on regression — reverting the drop fails 3 of 6.

### A claim that was never tested reads exactly like one that was

Staleness at least has a timestamp you can interrogate. **An untested claim has
nothing** — once written down it is indistinguishable from a measured one, which
makes it the more dangerous case.

**When a limitation justifies an architectural choice, test it before building
around it — and record HOW it was tested, not just that it holds.**

The most expensive instance in this build: *"Overpass footprints unreachable
from this environment"* was written in the design brief, inherited into these
limitations, repeated in commit messages, and quoted back and forth as
established. **Nobody ever tested it.** Overpass answers fine — it returns 406
to a request with no `User-Agent`, which is most likely what the original
attempt hit. That one line is the entire justification for hand-modelling
eighteen buildings: `massing-layer.ts`, `lib/massing.ts`, `makeProjector()`, the
pin-vs-building misalignment class and `map-tilt.mjs` all descend from a
constraint that did not exist.

Constraints now carry their test:

| Constraint | How it was tested | Result |
|---|---|---|
| Overpass unreachable | `POST` with a `User-Agent`, 2026-08-04 | **FALSE** — 200, 220KB of buildings |
| Five hosts block automated fetching | `curl -sL -w %{http_code}`, browser UA, re-run 2026-08-04 | **TRUE** — MGM `000`, Golden Nugget `403`; Boyd and Westgate `200` on the same run |
| `next-env.d.ts` must be committed | fresh clone, file deleted, `npm ci`, `tsc --noEmit` + `next build` | **FALSE** — typechecks without it and Next regenerates it |
| Dress code / drinks 0/17 | absence across 17 fetched pages | **WEAK** — an inference from not finding it, not a test that it is unpublishable |
| OSM heights are either right or absent | counted `height=` vs `building:levels=` across 1,283 corridor buildings, then read the named short ones | **FALSE** — 72% of tagged buildings are levels-only, and 40 named buildings ≤3 storeys include *"Hotel MGM Grand Las Vegas"* at **2**. **0 buildings carry `building:part`**, so podium-vs-tower is undetectable from the tiles |

That last row is deliberately marked weak rather than quietly promoted. It is
the same shape as the Overpass claim and has not earned "will stay there".

This is why `verified_at` exists in the first place. A fact needs a date because
the world moves underneath it. We built that discipline into the product while
repeatedly failing to apply it to our own work; the fix is not more care, it is
**re-deriving instead of recalling** — re-read the git state, re-run the count,
re-look at the render.

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

**Data: seeded as candidate data.** 17 rooms · 75 cash games · 12 amenity types ·
8 room-amenity links · 42 sources, every row carrying `source_url` and
`fetched_at` with `verified_at` NULL. Figures in the *design comps* remain
placeholders; the database behind the app does not.

## Build order

1. ~~Apply the schema~~ ✅ done, locally
2. ~~Seed data — 17 rooms, researched by hand~~ ✅ done — candidate data, all
   unverified. The floor visit is what promotes it
3. **Next.js app reading from the DB** ← current step. Landing map (Tier A pins
   + Tier B massing), Just the Facts, room detail, tournaments and promos are
   built; the compare tray and the six surfaces' polish continue
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

## Extruding only our own 17 casinos — and the height debt that blocks it

The tile building layer is **dropped**. Only the 17 footprints extrude, and only
where a **sourced height** exists; everything else renders as a flat footprint.
`building:levels` is deliberately NOT used to synthesise a height — that is the
inflation path and the podium tag wearing a different hat.

**Measured against the footprint file as it stands: 2 of 17 would extrude.**

| | rooms |
|---|---|
| real `height=` | **2** — ARIA 20 m, Bellagio 120 m |
| `building:levels` only | 4 — Horseshoe 26st, GVR 6st, MGM Grand 2st, South Point 1st |
| nothing | 11 |

**And one of the two is wrong.** ARIA's is **20 m** — the podium, not the 183 m
tower. That is not a tagging accident: `scripts/room-footprints.mjs` picks by
CONTAINMENT, which is the right question for *"which building is the poker room
inside?"* and the wrong one for *"which mass represents this property on a
skyline?"* At ARIA those are different buildings.

**So the height work is two decisions per room, not one:**

1. **which polygon** represents the property's mass — the containment match is
   correct for the room and may be the podium for the skyline
2. **what height** it is — from a published source, carried with `source_url`,
   `fetched_at` and `verified_at` like every other fact in this product

Until both are done, the map shows 15 flat footprints and 2 extrusions, one of
them a 20 m ARIA. **That is the rule working**, not a bug — flat means "we have
not sourced this", which is true. But it is a long way from a skyline, and the
gap is data, not code.

## The map runs on MapLibre (migrated 2026-08-04)

Vector tiles from OpenFreeMap, extruded from `render_height`. **Every building
in frame**, rather than eighteen hand-modelled shapes on a flat plane.

**Deleted, not orphaned** — all of it existed only because we lacked building
data, and dead code left uncalled is the hazard deferred:
`app/massing-layer.ts` · `lib/massing.ts` · `makeProjector()` and the
shared-camera fix · `scripts/map-tilt.mjs` · `scripts/map-fit.mjs`. **MapLibre
has one native camera, so the pin-vs-massing misalignment class does not exist
here** rather than being managed.

**Constants RE-MEASURED, not ported** (`node scripts/map-measure.mjs`, using the
real supercluster MapLibre uses internally). MapLibre tiles are 512px where
Leaflet's were 256, so **every zoom is one step closer in pixel terms** —
carrying z11 across would have been wrong before anything else was considered.

| | Leaflet (old) | MapLibre (measured) |
|---|---|---|
| whole valley | z11, 40px absorption | **z10, cluster radius 50** |
| — result | 9 pins, 17/17, gap 20.6px | **8 pins, 17/17, 0 overlaps, gap 71.2px** |
| Strip landing | z14.5 / CSS tilt | z14.5 / **pitch 52** |

**Cluster radius 40 was rejected on evidence:** it produced overlapping pins at
z9.5 and z10.5. Supercluster **grids** rather than absorbing, so a smaller radius
does not guarantee separation the way the old absorption pass did — the two
algorithms are not interchangeable and the old constant would have looked
reasonable while overlapping.

**What we knowingly accept:** `render_height` is pre-merged from `height=` and
`building:levels` upstream, so podium-tagged resorts render short — MGM Grand
and New York New York as low boxes beside ARIA's correct height. Upstream OSM
edits are the only lever. The flat-footprint rule above is superseded for the
map, not deleted.

**Provenance debt:** `lib/room-footprints.ts` is checked-in geometry with no
`source_url` / `fetched_at` / `verified_at`. Fine for a migration; **not fine for
production** — those 17 polygons belong in the database like every other fact.

## The landing view opens on the Strip

The skyline is the front door. **z14.5, chosen on evidence** (`node
scripts/map-tilt.mjs`, Strip centre, tilted):

| zoom | lean of a 155 m tower | rooms in view | rendered pins | closest pair | overlaps |
|---|---|---|---|---|---|
| 14 | 10px | 10/17 | 9 | 58.2px | 0 |
| **14.5** | **14px** | **9/17** | **9** | **42.8px** | **0** |
| 15 | 20px | 6/17 | 6 | 58.5px | 0 |

z14 is the honesty *floor* and shows the weakest version of what we land there
to show; z15 buys 6px more lean and costs a **third of the visible roster**.
14.5 is the lowest zoom where the massing meaningfully reads with over half the
roster still on screen.

**In 3D the building is the room; the pin is a locator.** A single pin renders
as a 32px disc in flat mode and a **14px dot** in 3D. Measured at the landing
view, **10 of 17 buildings are narrower than the 32px disc standing on them** —
Westgate is 28×13px under a 32px pin, which is why one room read as "a flat disc
where everything else is extruded". It was never missing massing; the marker was
hiding it. With the dot, buildings narrower than their marker drop from
**11/17 to 1/17** at z14.5. The one remaining is Skyline, which is small because
it *is* small — a 12 m single-storey room — and that is a fact, not a failure.

**Is there a useful step between 14.5 and 15?** Measured, and essentially no:

| zoom | lean | in view | buildings under a 32px pin |
|---|---|---|---|
| 14.5 | 14px | 9/17 | 10/17 |
| 14.6 | 15px | 9/17 | 8/17 |
| 14.75 | 17px | **7/17** | 3/17 |
| 15 | 20px | 6/17 | 1/17 |

The legibility cliff sits between **14.6 and 14.75**, and crossing it costs two
rooms (9 → 7), dropping below the ~8-in-view floor. **14.6 is the only step that
holds coverage**, and it buys little. Note also that `zoomSnap` is 0.5, so 14.6
and 14.75 are not reachable resting zooms without lowering it to 0.1.

**One camera, because two disagreed.** Leaflet places markers untilted while the
massing is tilted — measured at the landing view, a room's pin sat a median
34–47px and up to **213px** from its own building. Pins now project through the
same camera as the massing (`makeProjector`), and absorption runs in the space
they are actually drawn in.

**The count and the viewport no longer contradict each other.** The panel says
"17 rooms" but the Strip view shows 9, so it also says *"Showing 9 of 17 on
screen — see the whole valley"* with the control inline. **THE STRIP** and
**WHOLE VALLEY** are peer controls: completeness is the product's claim, and the
valley view is where "every poker room in the valley" is something you can count.

**Tier A's whole-valley fit is unregressed** and re-verified after the change:
z11 → 9 rendered pins for 17/17 rooms, 0 overlapping pairs, tightest edge gap
20.6px.

*Note on the 8-room cluster:* it contains The Orleans, ~2.7 mi off-Strip. It is
a proximity artifact of absorption, not a geographic claim — clusters render a
bare count and "N rooms here", never an area name. **Do not label a cluster by
area**; the moment one reads "STRIP" it asserts something false.

## The 3D massing — what it is, and what it cannot be

Tier B extrudes building massing over the Strip. Two limits are structural, not
todo items, and belong here rather than being discovered by a viewer:

- **Only 18 venues and 5 landmarks extrude. Every other block stays flat.**
  Overpass building footprints were unreachable from this environment, so the
  masses are hand-modelled approximations in `lib/massing.ts`, keyed by room
  slug and hung off the real OSM centroids. It is a skyline of the rooms we
  cover, not a model of the city. (The count is 5 landmarks — Luxor, Excalibur,
  New York-New York, Stratosphere, T-Mobile Arena — not 6.)
- **Tilt is applied to the massing, not to the ground.** Leaflet renders tiles
  flat; only the canvas overlay is tilted, so in 3D the tiles are damped to .38
  and the massing carries the depth cue. The mock avoided the mismatch by
  dropping tiles entirely.

**3D activates at z14, not z13.5** — the module's own fine-footprint threshold
(ppm ≥ 0.12), not an aesthetic pick. Below it the original code *inflated*
masses to a floor size so they stayed visible, which is fabricating a fact about
how big a building is: the same class of error as inventing a rake figure, on
the surface where this product's honesty is most visible. **That inflation path
is deleted**, and `drawMassing` now returns rather than drawing if ppm ever
falls below the threshold.

**Measured against real centroids** (`node scripts/map-tilt.mjs`), because the
tilt geometry was tuned on mock ones:

| zoom | px/m | flat closest | tilted closest | tilt penalty |
|---|---|---|---|---|
| 13.5 | 0.092 | 35.9px | 22.4px | **−37%** |
| 14 | 0.130 | 50.7px | 31.1px | −39% |
| 15 | 0.259 | 101.5px | 58.5px | −42% |

**Tilt costs 37–48% of pin separation** — it compresses toward the horizon
exactly as predicted, and at z13.5 it turns 0 flat collisions into 1. Two
consequences worth knowing:

1. **3D barely reads until z15.** A 186 m tower leans **9px** at z13.5, 12px at
   z14, 24px at z15. The module's own fine-footprint threshold (ppm ≥ 0.12) is
   not met until **z14**, so at the z13.5 activation floor masses are still
   being inflated to stay visible.
2. Below `MIN_3D_ZOOM` the pin layer owns the view untouched. **Tier A re-measured
   after the cluster size step**: clusters render at 44px with a ring so they read
   as a different object, absorption widened to 40px to clear the widest pair
   (22 + 16), giving home z11 → **9 rendered pins for 17/17 rooms, 0 overlapping
   pairs, tightest edge gap 20.6px**. The step costs one room: The Orleans is
   absorbed into the Strip cluster, which becomes 8.

## The migration is still a draft — and the exact day it stops being one

`00000000000001_initial_schema.sql` is edited **in place**, not fixed forward.
It has run many times locally, which sounds like it should count, and doesn't.

**The trigger is not "it has been applied" and not "it is on GitHub". It is:
any database you cannot freely reset has run it.**

- `supabase db reset` regenerates from scratch on demand → still a draft.
- A fresh clone resets the same way, so **pushing to GitHub changes nothing**.
- **Creating a hosted Supabase project changes it permanently**, because that
  database holds state nobody can casually throw away.

So: keep editing the migration in place until the hosted project exists, and
switch to fix-forward the day it does. Written here so it is a trigger to check
rather than a judgement call to relitigate.

## Enforcement audit — which decisions have something behind them

A locked decision can sit in this list for days with nothing enforcing it.
`is_seasonal` proved that: "off the roster and all counts by default" was
written here, agreed, and implemented nowhere. The point of this table is not to
enforce everything — process rules belong in prose — but to make **prose-only a
decision rather than an oversight**.

Legend: **code** = enforced in the read path · **test** = enforced by a failing
test · **prose** = correctly prose-only · **GAP** = should be enforced, is not.

| Decision | Status | Where |
|---|---|---|
| Roster: 17 rooms, WSOP·Paris seasonal and off all counts | code + test | `inRoster()`; `test:mixed` seasonal scenario |
| Closed room leaves the roster but keeps a dated page | code + test | `inRoster()`, `closure_is_dated` constraint, `test:mixed` |
| Temporarily closed is shown but never ranked | code + test | `isRankable()`; `test:mixed` |
| Provenance: verified or tilde'd, never a third state | code + test | `Cell`, `EmptyBlock`; `test:mixed` |
| Unverified figures are never ranked | code + test | `rank()` gates on `verified`; `test:mixed` |
| Confirmed absence is a fact, not a gap | code + test | `EmptyBlock`, `available` filters; `test:mixed` |
| Enumerate vs summarise past `ENUMERATE_MAX` | code + test | `exclusionLine()`; `test:mixed` boundary scenarios |
| Any sortable column has a real number behind it | code | `SortSpec.value` typed `number \| null` — a string sort is a **compile error** |
| A sort's direction and metric are part of the claim | code + test | `sortCaption()` derives from `direction`; `test:mixed` |
| Rank is tied to the active sort and says so | code | `sortHead()` — `# BY RAKE` derives from the same spec |
| RLS needs explicit GRANTs | test | `supabase test db`, 10 assertions |
| A row cites its own source, never its parent's | prose | **no useful guard exists.** A partial check flagging rows that inherit the parent's `source_id` was considered and rejected: 15 of 16 rooms legitimately cite one page for both rake and stakes, so it would be almost entirely false positives. Stated as a limit, not an oversight |
| Games have exactly one source of truth | code | `amenity_types` holds no game rows; GAMES group queries `cash_games` |
| Amenity filters are coverage-gated | code | `shipped` flag on `GROUPS` |
| `area` is a classification, not a fact | prose | naming convention; no runtime meaning |
| Zero-verified is the primary state | test | `test:mixed` ZERO scenario |
| Floor visit records absences explicitly | prose | a capture-process rule — nothing in the app can enforce what a person writes down |
| Palette / no raw colour | code | `no-restricted-syntax` in `eslint.config.mjs` — hex, `rgb()`/`hsl()` and template-literal forms all error on `app/`, `lib/`, `components/`. Exemptions written down in that file; `readToken()` in `lib/tokens.ts` is the sanctioned path for canvas |
| Compare dims in place and never reorders | code + test | map collects into `?compare=`; `/facts` dims non-picks and **never reorders or renumbers**; `test:mixed` asserts byte-identical order and identical ranks |
| Editorial content is labelled as editorial | **GAP** | `reliability` is display-only by convention; nothing stops a future surface sorting it |
| Mobile: no interaction without a touch equivalent | prose | a design review rule |

One GAP remains — editorial labelling, which needs the tournaments surface that
has no data yet. `compare` closed with the landing map pass, updated here as
part of that pass rather than after it, so the audit never lags the code. The palette gap is **closed** — deliberately
before the landing map rather than after, because the map is the surface most
likely to acquire ad-hoc colour, and a rule added afterwards is a cleanup while a
rule added first means the drift never gets written.

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
- **The schema encodes more states than a naive read interrogates — filter them
  or write down why not.** `room_amenities.available` sat as `boolean not null`
  for days, harmless only because the seed never wrote `false`; it would have
  gone live as a display bug the day the floor visit recorded its first
  confirmed absence. That is a *shape*, not a one-off. Every state-bearing
  column on a public read path is now either filtered in
  [`lib/roster.ts`](../lib/roster.ts) or listed there under
  `UNFILTERED_BY_DESIGN` with its reason, so a later sweep can tell "considered
  and rejected" from "never looked at". The rules: `closed` leaves the roster
  entirely; `is_seasonal` is off the roster and every count by default (a locked
  decision that until now lived only in prose and no read path enforced);
  `temporarily_closed` **stays listed but cannot rank**, because a room you
  cannot enter cannot be the city's best anything; and a dated thing needs
  `is_active` **and** its date window — a promotion whose `ends_on` has passed is
  over whether or not anyone cleared the flag.
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
- **Room pages invalidate ON WRITE; the `revalidate` window is a safety net, not
  a staleness budget.** `/rooms/<slug>` is prerendered with `revalidate = 300`,
  which is what makes those pages cheap — and they are the SEO long tail, so the
  window stays. The problem is not the window, it is that a *change* waits five
  minutes. **And the moment it is wrong is the moment someone verifies a room —
  the single event this product exists to reflect.** A page reading UNVERIFIED
  for five minutes after a floor visit confirmed it is the product contradicting
  itself on its own core claim.
  So: call `revalidatePath('/rooms/<slug>')` when a verification lands or a
  correction is approved. Then 300s never fires in the normal case.
  **The obvious wrong fix is lowering the interval** — it trades the cheapness of
  the long tail for a shorter wrong-window, and still leaves one. Invalidate on
  the event; do not shorten the guess.
  *Not yet wired, because nothing writes verification yet.* The hook points are
  the admin review queue (build-order step 5) and whatever records a floor
  visit — both must call it, and this entry exists so neither ships without it.
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
