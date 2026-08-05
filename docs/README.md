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

**A CITED HEIGHT ON A GUESSED POLYGON IS THE ARIA ERROR WEARING A CITATION.**
Two facts have to be sourced — *which polygon*, and *how tall* — and one without
the other is **worse than neither**, because the citation lends false confidence
to the guess. Red Rock's ~60 m is properly cited and still not seeded: no
polygon there is named, so picking one means choosing the largest unnamed shape
and calling it the tower.

**A NAMED OSM polygon carrying a height tag IS a citable source.** It has a
stable URL, a version history with timestamps, and an identifiable subject —
more provenance than several facts already seeded here. The qualifier does all
the work: an **unnamed** polygon has no identifiable subject, so
`way/316302064` identifies a shape, not a building, and a citation attached to
it certifies nothing.

*This rule was arrived at by catching an inconsistency:* OSM's 120 m was being
recorded as a citable figure in Bellagio's conflict while OSM's 133 m on a named
Palace Tower was refused — so Caesars' tallest tower rendered flat beside a
shorter one. **A source cannot count in one row and not in another.** Applying
one rule to both seats Caesars properly and leaves Bellagio a genuine
disagreement between two sources rather than a question about whether one counts.

**Palazzo is the counter-case worth keeping.** OSM independently tags it 196 m,
matching the Wikipedia figure, on a **named** building — two sources agreeing
about an identified thing. That is exactly what ARIA's withdrawn cross-check was
not: same shape, opposite outcome, and **the difference is whether the thing
being agreed about has a name.** ARIA's tower is seeded on the weaker basis —
an unnamed polygon whose own height tag matches the citation — and carries
`identified_by` saying so.

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

## Map load time — ANSWERED. The map was never drawing. (2026-08-04)

**The map had no worker, so it never requested a single tile.** MapLibre v6
builds its worker from a Blob that imports `import.meta.url`; Turbopack rewrites
that to the **page** url, so the worker fetched the HTML document as its own
source and died. Vector tiles are fetched **inside the worker**. Everything on
the main thread kept working perfectly: style `200`, TileJSON `200`, sprites
`200`, `transformRequest` firing for all 12 tiles — and **zero network
requests**, no exception, no console output, forever.

Fixed by serving the worker ourselves (`setWorkerUrl`), from a **generated**
copy: `scripts/sync-map-worker.mjs` walks the worker's import closure out of
`node_modules` into `public/`, and `npm run check:worker` fails the build if it
drifts from the installed package.

**Measured, in a browser, n=3 each** (production build, self-hosted worker):

| | time to first tile |
|---|---|
| cold cache | **1168 ms** |
| warm cache | **457 ms** |

So: not 26–46 seconds. Not tiles, not throttling, not the restyle.

### What this retires

- **"83 `setPaintProperty` calls" was not the cause.** That entry sat here as an
  improvement *pending confirmation*; it is now confirmed **not** to have been
  the problem. The style-object transform stays — doing the work once instead of
  55 times against a live map is better on its own terms — but it fixed a map
  that was never going to draw, and this file said it was fixed when it wasn't.
- **The tile building layer was not the cause.** Also removed for real reasons.
- **The throttled tab was not the cause.**
- **The loading state was correct the entire time.** It said the ground map had
  not arrived. It had not, and never would.

### A subsystem that works off the main thread fails silently on it

Every signal available on the main thread said the map was healthy. The failure
lived one boundary away, where nothing was watching. **When work is delegated —
worker, iframe, service worker, background job — the delegating side succeeding
is not evidence the work happened.** Watch the thing that does the work.

### One silent failure hid another

With the worker dead, `load` never fired, so our own layers were never added, so
`fill-extrusion-opacity: ['case', ['feature-state', 'hover'], ...]` never raised
`data expressions not supported`. It surfaced the instant tiles started flowing.
**Fixing the outer failure is how you find the inner one** — expect a second
defect after a long-masked one clears, rather than reading first-green as done.

### Ask what your observable cannot distinguish — THREE times in one session

1. **Tile count.** The only signal that separates "slow map" from "dead map".
   Style status, console output and canvas appearance are all identical between
   them. A dark empty canvas looks exactly like a dark map.
2. **`canvas.clientWidth`.** Used to test the resize path; it tracks the
   container by CSS alone, so it passed with the guard ablated. It measured the
   browser's layout engine while wearing the name of a test of our code.
   `canvas.width` — the GL drawing buffer — is the number only `resize()` moves.
3. **Window resize vs container resize.** MapLibre installs its own window
   listener, so resizing the viewport tested the library, not us.

The pattern each time was reaching for the number that is **easy to read** over
the number that **can be wrong**.

### A guard you did not ablate is not a guard

A `ResizeObserver` was diagnosed as the fix for a 0x0 container. Direct
measurement disagreed: the container was **1138x836 on the first probe, before
any change**, and MapLibre v6 already observes its own container — with ours
ablated, everything still passed. It is **not** in the code, and
`app/MapShell.tsx` says why, because "add an observer" is a plausible-sounding
fix someone will propose again. `scripts/map-probe.mjs` keeps the assertion:
the behaviour matters whoever provides it.

The diagnosis was wrong; the **method** was right, and it is what found the real
cause — read the network log, notice the style loaded and no tile followed,
refuse to accept a clean console as evidence of health.

### A checked-in copy of someone else's file goes stale silently

`public/maplibre-gl-worker.mjs` is exactly the hazard this project keeps
relearning, so it is generated and hash-checked rather than copied by hand. The
first attempt copied the worker **alone**; it 404'd on its sibling module and
died just as quietly as the bug it was fixing — same zero tiles, same clean
console. The script now walks the import closure and **hard-fails on a
non-relative specifier** instead of discovering it in a browser.

**A failed palette degrades visibly rather than blanking.** Moving construction
behind a fetch introduced a failure whose symptom is identical to the blank map —
no map either way. So if the fetch or transform throws, MapLibre is handed the
style URL directly: a correctly-rendered map in the **wrong colours**, with
`PALETTE FAILED` in the badge. A blank map tells you nothing; a
Positron-coloured one tells you exactly which step failed.

## The ground map carries the palette (2026-08-04)

The ground was neutral dark while only the buildings were aubergine. It now
carries the palette, under **two rules that are about meaning, not taste** —
both of which are what stop it reading muddy.

**1. Saturation carries meaning, so decoration gets the desaturated end.**
`--cid-value` (#4FBFAE) means *verified*: good rake, confirmed figures, the live
dot. A decorative saturated teal on the same screen would blunt it exactly as a
brand-red that cannot mean warning. Water is the same family at a fraction of
the **chroma**, so it never competes. Where a map layer and a data signal could
sit adjacent, **the data signal wins the saturated value.**

**2. Aubergine goes in the shadows, not the highlights.** The buildings are the
figure and the ground map is the ground. The dark end (land, parks, water) is
tinted toward the accent; the light end (road bodies, labels) stays near-neutral
paper. If the streets went aubergine at the buildings' weight, the towers would
stop reading — and the towers are what the whole 3D arc was for.

Parks, woodland and golf are **aubergine-tinted, never green**. The palette bans
green-as-good, and the Wynn golf course rendering green beside a teal "verified"
marker would contradict that on the front page.

All of it lives in `applyPalette` (pure, testable) and every colour is a
`--cid-map-*` token in both themes. `classifyLayer` sorts the style's **real 55
layers** into ten classes; `other` is a real answer and those layers keep their
upstream paint rather than being coloured on a guess.

### Six rules, each proven to go red

`lib/map-style.test.mjs` asserts against the **real palette parsed out of
colors.css**, not a mock — a mock satisfies whatever invariant you write for it
while the shipped colours quietly break the same rule. Each was verified by
injecting a violation: a green park, a road brighter than a building, a
saturated decorative teal, a land colour too light for label contrast.

**Two measures, because "saturated" means two things.** *Chroma* (absolute
colourfulness) answers "does this compete with the teal that means verified?".
HSL *saturation* answers "is the tint in the shadows?". Using saturation for
both called a near-black teal-slate (0.34) a rival to vivid #4FBFAE (0.47) — it
divides by lightness, so it cannot tell a faint lean from a real colour.

### A colour you never chose cannot be caught by checking the colours you chose

Positron ships `fill-outline-color: rgb(219,219,218)` on its building layer —
the only one in the style. Setting `fill-color` and leaving it painted a
**near-white mesh over every block in the valley**: the brightest thing on the
map, on a layer meant to be quiet texture, straight through a figure/ground rule
that only ever inspected our own tokens.

The fix is a guard that does not depend on having imagined the failure: **no
`*-color` on a layer we claim to have recoloured may still hold its upstream
value.** Positron is a light theme, so every colour it ships is wrong for us —
survival is the defect, whatever the property is called.

The same audit found route shields, which are **sprite images**: `icon-color`
does nothing to them, and at full strength they measured as pure white
(L=1.00) against buildings at L=0.19. Muted to 0.5 rather than hidden, because
I-15 and Las Vegas Blvd are real wayfinding.

### The rendered pixels, not just the tokens

The token tests pass on values we control; they cannot see what actually
reaches the screen. Sampling the rendered canvas found **0 green-dominant
pixels** and cut the brightest pixel from **L=1.00 to L=0.44**.

One honest exception: **label text is brighter than a building** (0.31% of
pixels) and stays that way. It has to hold 4.5:1 or it is not legible. The
figure/ground rule governs the map's **masses** — fills and lines — not the
information layer on top of them.

### Contrast is now measured rather than asserted in prose

The ≥4.5:1 floor existed only as a comment beside `--cid-dim`. It is a test now,
measured **against the halo** rather than the land: a label crosses water, park
and road within one pan, so there is no single background to measure, and the
halo is the background the text actually sits on.

## Hue share — the number that should have existed first (2026-08-04)

Phil called the map monochrome **twice**, across two palette passes that both
passed every test. The cause was measurable and nobody had measured it:

| | before | after |
|---|---|---|
| aubergine | **69.5%** | 48.1% |
| neutral | 26.6% | 34.7% |
| gold | **0%** | 14.9% |
| indigo (water) | 4.0% | 1.7% |
| moss (parks) | **0.02%** | 0.03% |

**The hue variety was outside the frame.** Indigo water and moss parks are real
choices, but at the Strip landing there is almost no water and virtually no
park — so the view resolved to aubergine land, aubergine roads, aubergine
buildings. We had coloured features that are not on screen.

**Token tests cannot see this.** Every rule in `map-style.test.mjs` asks what a
colour *is* — its hue, its chroma, its luminance against a building. None can
ask **how much of the frame it occupies**, and area is the variable that decides
whether something reads as an accent or a surface. `scripts/map-probe.mjs` now
samples the rendered canvas and reports the share of every hue, so the next
palette argument starts from a number.

It is the same shape as the dead worker: the failure was invisible to every
check we had because no check looked at the rendered output.

### Gold on the buildings, gold on the fine grid

- **Gold outlines the 16 masses.** `fill-extrusion` has no outline property, so
  the footprint geometry is redrawn as a thin line. **An outline is a LINE, not
  a SURFACE** — gold stays an accent by geometry rather than by discipline — and
  edge definition is what makes massing read, so it reinforces the buildings
  being the brightest thing rather than threatening it.
- **The minor grid is gold; the arterials stay purple.** The boundary is which
  roads: casing and major are continuous arterials that form a shape across the
  frame, which is what a surface is made of. The fine grid is texture. The
  hierarchy is deliberately inverted — **fine grid glints, arterials recede,
  buildings dominate.**
- **Weight is the lever, never the hue.** At Positron's shipped 0.9 opacity the
  gold grid measured 19.8% of the frame and the dense blocks read as a field.
  Dropping to 0.55 kept the glint and lost the haze: 14.9%. Reverting the colour
  is what produced "too monochrome" twice, so the opacity is now asserted.
- The luminance chain still holds — `--cid-map-road-minor` is a **dark** gold,
  held below the casing. The chain is the weight limit: a gold minor that breaks
  it is too heavy.

**Still open, and now quantified:** moss and indigo are 1.7% of the frame
between them. If more hue variety is wanted, the lever is a hue on something
that IS in view — land, buildings, the grid — not more colour on water and parks.

## Outlining a 3D volume: one technique measured and rejected

`fill-extrusion` has no stroke, so "outline the whole building" is a change of
technique, not a parameter. Two were built and both were rendered before either
was believed.

**SHELL — rejected, and kept in the code so nobody proposes it again.** The
footprint buffered 2 m outward as a donut (outer ring buffered, inner ring the
original) and extruded to the same height. In plan it is exactly an outline: the
hole is the building. **At pitch it is not.** The shell's outer wall stands *in
front of* the mass at equal height, so it occludes rather than rims — the
buildings render solid gold with purple slivers on the far faces only. The donut
hole helps looking straight down, and the map is pitched 52°. `screens/10-shell.png`
is what that looks like; the reasoning was sound in plan view and wrong in the
view we actually ship.

**CAP — the default.** A second extrusion occupying the top 3 m of the mass: a
gold crown at the roof. With the footprint line still drawn at the base, the
volume gets a top edge and a bottom edge, which is the readable part of an
outline at this camera.

`NEXT_PUBLIC_MAP_EDGE=cap|shell|base` switches between them.

The buffer is a miter offset computed in **local metres**, not degrees — a degree
of longitude at latitude 36 is 0.81 of a degree of latitude, and treating them as
equal would buffer more east-west than north-south. The winding of an arbitrary
OSM ring is not assumed either: the offset is applied, the area compared, and the
direction flipped if the polygon came out smaller. A shell that shrank would sit
inside the mass and be invisible — a silent nothing, which is the failure mode
this project keeps finding.

### Gold outlines the arterials; it does not become them

The casing is drawn **wider than the body** (Positron: 3 vs 2 at z10), so a gold
casing beneath a purple body shows as an edge down each side. Gold stays a line.
That boundary has now moved twice — first "which roads" (grid yes, arterials no),
now "which part of a road" (outline yes, body no) — and each time the rule was
narrowed rather than dropped, because the thing being protected never changed:
**gold may not become a surface.**

### Halving the gold, without halving the text

Phil asked for the map gold at about half brightness. **The UI gold does text
work with a hard 4.5:1 floor**, so the dimming is scoped to `--cid-map-*`
(`#C9A227` → `#8A6D1F`, luminance 0.385 → 0.164). Verified the guard actually
guards: halving the shared scale fails both the per-surface contrast rule and
the scoping rule.

### Hue share after: gold did NOT climb

| | before | after |
|---|---|---|
| aubergine | 48.1% | 44.4% |
| neutral | 34.7% | 39.1% |
| gold | 14.9% | **13.6%** |
| indigo / moss | 1.7% | 1.4% |

**Read that with the caveat, because the metric moved under it.** The probe
counts a pixel as `neutral` below a chroma of 10, and halving the gold pushed
dim gold pixels under that floor. At a chroma floor of 6 the comparison is
**17.0% → 16.4%** — so the added geometry (volume caps, arterial casings) was
almost exactly cancelled by the halving. Gold covers about as much as before and
is half as loud.

That is worth knowing about the instrument itself: **a share metric with a
threshold is not invariant to a brightness change.** Quoting only the 13.6%
would have implied gold shrank when its coverage barely moved.

## The roof was a slab, not an outline (2026-08-04)

The gold "crown" extruded the whole footprint over the top 3 m, so its top face
was the entire roof: every building wore a gold lid. The fix is the same
technique made **hollow** — a donut whose outer edge is the real footprint and
whose inner edge is pulled 3 m in, extruded over the top 2 m. The top face is
then a ring and the roof reads as an outline.

Narrow towers cannot take a 3 m inset without the ring closing on itself, so the
band **thins before it gives up** (3 m → 1.5 m → 0.8 m). Forum Tower needs 1.5 m.
Dropping it instead would have left one mass with a filled gold roof beside
fifteen outlined ones, which reads as a rendering bug rather than a rule.

Growing and shrinking a ring need **opposite** winding choices, and getting it
wrong is silent both ways: a shell that shrank hides inside the mass, a roof ring
that grew swallows the roof it was meant to outline. Both directions are built,
the areas compared, and the one that moved the right way is kept.

### What true vertical edges would cost — measured, not estimated

Phil wants **all the edges, vertical and horizontal**. The roof ring plus the
existing base line gives the horizontal ones. The verticals cannot be done with
any built-in layer: **MapLibre line layers are ground-plane only**, so there is
no supported way to draw an elevated 3D line.

The real answer is `map.addLayer({ type: 'custom', render(gl, matrix) })` with a
line-primitive wireframe. Before costing it, one thing was measured rather than
assumed:

```
ALIASED_LINE_WIDTH_RANGE = [1, 1]
```

**WebGL will not draw a line thicker than one device pixel.** `gl.lineWidth()`
is a no-op above 1 in ANGLE, which is what Chrome, Edge and Electron all use.
That single number splits the work in two:

- **Hairline wireframe — ~150 lines.** `gl.LINES` over a vertex buffer of the
  977 footprint vertices, each as a vertical segment plus a top-ring segment
  (~2,000 segments, nothing for the GPU). Needs Mercator conversion, a small
  shader, and depth-testing against the extrusions so edges hide correctly
  behind masses. The catch is that a 1-device-pixel line on a 2× display is a
  half-CSS-pixel hairline — faint, and not adjustable.
- **Adjustable-thickness wireframe — ~300+ lines.** Each edge expanded into two
  triangles with the offset applied in screen space after projection, plus join
  handling at corners. This is what you need if the hairline reads too faint,
  which on a retina display it probably will.

Both need depth handling tuned against `fill-extrusion` to avoid z-fighting, and
neither is unit-testable — only the browser probe can confirm them. **Not built
on spec.**

## Hover was spending the colour that means verified — caught regression

The map's hover was `--cid-value`: **the teal that means verified**, used as
decoration. It is the same mistake as an ochre "unverified" — a hue that carries
a claim, spent where nothing is being claimed — and it shipped because nothing
asserted that the map's decorative colours stay clear of the semantic ones.

Hover is now gold, and `--cid-value` is **gone from `MAP_TOKENS` entirely**:
it was there only to paint the hover, which is itself the evidence that the teal
was never doing semantic work on the map. When something on the map does state
verification, it comes back.

It could not simply become the map gold either. That gold is dim and covers
~16% of the frame, so a hover drawn in it would vanish into the texture — **the
same colour cannot be both the background and the thing that stands out of it.**
So hover is separated by VALUE, exactly as brand teal was separated from
decorative teal: **hover takes the bright end, decoration keeps the dim end.**
Asserted three ways — hover is far from `--cid-value` in hue, is not the same
token as the decoration gold, and is at least twice its luminance and no dimmer
than an unhovered building. All verified red by injection.

### Hue share, at both chroma floors

| | chroma > 10 | chroma > 6 |
|---|---|---|
| before the roof ring | 13.6% | 16.4% |
| after | **13.1%** | **15.9%** |

Hollowing the roofs took gold coverage down slightly, as expected — a ring
covers less than a slab. Both floors are reported because the metric's threshold
is not invariant to brightness, which is a property of the instrument rather
than of the map.

## Dynamism: dusk, rise, drift, ping (2026-08-04)

Four behaviours, each screenshotted, and **every one of them is disabled under
`prefers-reduced-motion: reduce`** — verified in a browser with the media
feature emulated, not by reading the CSS. An ambient orbit nobody can stop is
hostile, not delightful.

### The dusk sky is set, and does not show at our camera

`setSky` + `setLight` cost almost nothing and the horizon is held below building
luminance by token, with the **sky now joined to the luminance chain** —
sky < horizon < roads < building. A sky is the one surface big enough to break
"the brightest thing is a building" silently: it is enormous, it sits behind
everything, and every previous assertion looked only at ground colours. Labels
are also checked against the **horizon** rather than the land, because a label on
the glowing band is the failure case and the land-coloured halo does not help
there.

**But it is not visible at the landing camera, and that is measured:**

| pitch | horizon in frame | tiles requested |
|---|---|---|
| 52 (ours) | **no** | 12 |
| 60 (MapLibre's default max) | **no** | 14 |
| 72 | yes | **29** |

Seeing the dusk band needs pitch above 60 — which means raising `maxPitch` past
the default *and* roughly doubling tile requests. Raising the landing pitch is a
change to a constant that was measured in a spike, so it is **Phil's call, with
the cost attached**: `screens/32-pitch72.png` is what it buys.

**The light was turned down from 0.4 to 0.22.** At 0.4 the warm sun lifted every
extrusion face toward its own hue and the aubergine masses came out dusty pink —
the buildings stopped being the accent colour. Low enough to rake, not to
repaint.

### The rise, and the bug the drift caused

Buildings animate 0 → full height over 950 ms, staggered by feature id so 16
masses do not stand up as one slab. It starts on `tilesIn`, not on mount: playing
the rise into an empty frame wastes it and reads as jank.

**The camera drift silently killed the rise.** The effect depends on `tilesIn`,
and `tilesIn` flips back to *false* the moment the drift rotates far enough to
need new tiles — so the effect cleaned up, cancelled the rAF at **p = 0.17**, and
the `roseRef` guard then refused to restart it. Sixteen towers sat permanently at
a sixth of their height and nothing reported a problem; `queryRenderedFeatures`
still counted 13 masses, because they existed, they were just short.

Two fixes, and the second is the general one:

- The drift now waits for the rise instead of racing it.
- **Cleanup lands the animation instead of merely stopping it.** Cancelling an
  animation is not the same as finishing it — if the effect tears down mid-rise,
  it settles to full height on the way out. Any interrupted animation should
  leave the correct final state, not the frame it died on.

### Drift: measured, and it stops rather than pauses

118 frames per 4 s while drifting (~30 fps), **0 frames per 4 s after the first
interaction** — it stops permanently, with no path back. It also expires on its
own after 20 s, and THE STRIP / WHOLE VALLEY kill it explicitly, because those
are panel buttons the canvas listener never sees and an orbit that keeps turning
after somebody asked for a view is the map arguing with them.

### The ping reuses the brand's knock

Selection throws `knockR1`/`knockR2` from the design system rather than inventing
a second motion vocabulary — the mark is a knuckle rap throwing rings and a map
ping is the same shape. Verified: 2 rings on click, popup opens, both cleaned up
after 1.7 s, 0 rings under reduced motion.

**Two of my own test bugs were worth more than the feature.** The first click
test ran while the drift was still turning the map, so the pin moved between
projecting it and clicking it. The second failed because **`map.project()` is
canvas-relative and `mouse.click` is page-relative** — the canvas sits below the
header and right of the panel. Both looked exactly like a broken ping.

### Hue share, both floors

| | chroma > 10 | chroma > 6 |
|---|---|---|
| before | 13.1% | 15.9% |
| after | **13.2%** | **16.1%** |

Essentially unmoved. The sky would have moved it — it is not on screen.

## MapLibre v6 has NO fog primitive — verified, not remembered (2026-08-04)

`setFog` is a **Mapbox** API. In `maplibre-gl@6.1.0` it does not exist: zero
occurrences in the shipped types and zero in the bundle. What MapLibre has is
fog *inside* `setSky` — `fog-color`, `fog-ground-blend`, `horizon-fog-blend` —
and that fog blends the ground into the **horizon**.

With the horizon off-screen at pitch 52, it does nothing, and "nothing" is
measured rather than asserted: sweeping `fog-ground-blend` from 0.08 to 0.95
with `atmosphere-blend` 0.4 → 1.0 changed **0.01% of pixels, mean difference
0.00/255**. For scale, turning the light down changed 70% of pixels.

### The nearest real thing: valley haze, and it is not called fog

A screen-space scrim in the fog colour. Named `.cid-mapfog` but described as
haze everywhere it is explained, because calling an overlay "fog" is how an
approximation gets mistaken for the API it is standing in for.

**It is distance-weighted, not a vignette.** Real haze fades what is FAR, and
under pitch the far ground is the top of the frame — so it is a top-weighted
gradient rather than a ring around the edges. Both were built and measured:

| | pixels changed | gold lost |
|---|---|---|
| radial vignette | 5.2% | 1.6 pp |
| **top-weighted (shipped)** | **28.8%** | **2.8 pp** |

Roughly three times the visible depth per unit of accent washed out, because it
puts the haze where the buildings are not. The first attempt — a heavy radial
vignette — cut gold from 13.2% to 7.4%, halving the accent three rounds of work
had just tuned.

The haze is a large-area surface, so it joins the luminance chain on the same
terms as the sky, and the label floor is now checked **through** it: the scrim
composited over the halo, then the text against that.

## The vertical gold wireframe

`lib/wireframe.ts`. The triangle-expanded custom layer, not the hairline —
`ALIASED_LINE_WIDTH_RANGE` was measured at **[1, 1]**, so width has to be built
rather than requested. Each edge becomes a quad expanded in the **vertex shader,
in screen space after projection**, which is what keeps a constant pixel width
while the ambient drift changes the matrix every frame.

**848 segments drawn** — a real count read out of the buffer, not a check that
the layer exists. A custom layer that renders nothing looks exactly like one
that was never added.

Three things it had to get right:

- **It animates with the rise.** The shader recomputes the same stagger curve
  from the same progress value, and `MapShell` now *imports* `WIRE_STAGGER`
  rather than declaring its own `0.35`. The test changed accordingly: it used to
  compare two numbers, and now asserts they are **one** number, which is the
  stronger guarantee.
- **Depth test on, depth write off.** Testing hides an edge behind a mass —
  without it this is an x-ray box. Not writing stops the ribbons occluding each
  other where two quads meet at the same depth.
- **It survives the drift.** 28.3 fps with wireframe + drift against 29.5 fps
  with drift alone: about 1 fps for the first per-frame custom work in the app.

The GL cannot be unit-tested, but the arithmetic can, and that is where the bugs
live: segment counts, altitudes in mercator units, whether the closing vertex of
a ring produces a phantom zero-length segment. `lib/wireframe.test.mjs` covers
those with no browser.

## The drift comes back, but only when the map is genuinely idle

"No click in 30 seconds" is not idle. The restart is blocked while a popup is
open, while the pointer is over the map, or within 30s of a filter change — and
each of those **resets the clock** rather than queueing a restart for the moment
it ends. Eased in over a second, because snapping into motion after stillness
reads as a glitch.

Verified in a browser, all four states:

| | |
|---|---|
| drifts on arrival | bearing −9.2 → −6.1 |
| interaction stops it | −18 → −18 over 6s |
| **held while a popup is open** | −18 → −18 over 34s |
| restarts once idle | −18 → +11.8 over 34s |

**The first of those was broken by my own fix and the test caught it.** The
filter-change effect stamped `lastActivity` on mount as well as on change, so
the map counted as just-used for its first 30 seconds and the arrival drift —
the part Phil actually liked — silently stopped happening. An effect that fires
on mount as well as on change is the ordinary shape of that bug.

`prefers-reduced-motion` still disables everything, wireframe included: height
settles to `["get","height"]` immediately, bearing never moves, 848 segments
still drawn at full height, no ping.

### Hue share, both floors

| | chroma > 10 | chroma > 6 |
|---|---|---|
| before haze + wireframe | 13.2% | 16.1% |
| after | **10.4%** | **11.9%** |

The haze accounts for essentially all of that: it is a translucent scrim over
the top half of the frame, so it dims gold pixels below both thresholds. Gold
coverage did not shrink; gold contrast did, which is what a haze is.

## The wireframe drew nothing for a whole session (2026-08-04)

It was reported working on the strength of **848 segments** in the vertex
buffer. Every number was true and none of them was about pixels:

```
segments 848 · rendered frames 274 · GL error 0 · layer present true
```

The layer was added, its `render` ran 274 times, it issued a draw call, and
nothing reached the screen. **A count of what you wrote into a buffer is not a
count of what was drawn** — which is the exact failure this file already
described, then verified around instead of through.

### The cause: the wrong matrix, ported from memory

MapLibre v6 hands `render(gl, args)` several matrices. I used
`args.modelViewProjectionMatrix`, which is the **v2/v3 custom-layer convention**
and belongs to a different space in v6: its translation row is ~1e7 while a
normalised mercator coordinate is ~0.18. Every vertex projected to **NDC
y = 2.34** — just off the top of the screen, silently, with no error anywhere.

The right one is `args.defaultProjectionData.mainMatrix`, which takes normalised
mercator. Same sample vertex, same frame: **NDC (0.42, 0.70)**.

This is the second time in this project that a MapLibre API was carried across
from an older version and failed quietly — the first was `setFog`, which does
not exist at all. Read the shipped types, then confirm against a computed value.

### Diagnosis order, and what each step ruled out

1. **Depth-test coincidence** — the leading hypothesis, tested first by drawing
   with `DEPTH_TEST` disabled. **0.01% of pixels changed: not the cause.**
   Keeping that answer mattered, because "turn depth off" would otherwise have
   looked like a fix and shipped an x-ray box.
2. **Draw order** — the wireframe sits after the extrusions. Fine. Worth noting
   `getStyle().layers` **does not list custom layers**, so its absence there is
   not evidence of anything.
3. **Program, uniforms, GL errors** — linked, set, zero.
4. **Where a vertex actually lands** — the step that found it. Multiply the
   matrix by a known vertex and look at the NDC.

### The check that should have existed first

`scripts/map-probe.mjs` now removes the layer and re-measures the canvas. The
only evidence that counts is that the picture **changes** when the wireframe
goes away:

```
wireframe   848 segments · gold 12.661% with, 11.966% without   (+0.695pp)
```

At 1.6 px the same delta was **0.014pp** — drawing, but invisible at the landing
zoom. Width is now 2.4. The wireframe is unmistakable close in
(`screens/64-close.png`) and subtle at z14.5, which is the honest description of
edge detail on 40-pixel-tall buildings.

**A bug in the check itself nearly hid this:** the block computed the `wire`
result and the return statement never included it, so the whole section silently
did not run. Checking the output rather than the exit code caught it.

## The arrival drift, and why the test kept saying it worked

Phil twice reported no drift on load while the headless check reported drift on
load. Both were true, and the difference was the mouse.

The old loop used ONE `busy()` test for two jobs: blocking a restart, and gating
the very first start. Pointer movement stamped activity. **In a browser nobody
holds still** — the map loads, the pointer arrives, activity is stamped, and the
welcome drift never happens. In headless the mouse sits at (0, 0) and never
moves, so the arrival drift always fired.

Now:

- **Arrival is unconditional.** It starts when the buildings finish rising and
  nothing gates it.
- **Only a real interaction stops it** — pointerdown, wheel, touch, key. Moving
  the mouse across a map is not asking the map to stop.
- **Pointer movement is activity for the RESTART clock only**, alongside an open
  popup and recent filter changes.

Verified against the real-world path — twelve mouse moves across the map after
load — rather than a still cursor: `-7.01 -> -3.40`, still drifting. Click stops
it; 32s idle brings it back.

**The instrument now says `motion full` or `motion REDUCED`**, because "the drift
is not running" has two causes that look identical from outside, and one of them
is an OS accessibility setting on a machine I cannot see.

## An experiment against a broken subject answers nothing (2026-08-04)

The wireframe flickered as the camera moved. Depth-fighting was the obvious
suspect — and this file already contained an experiment ruling it out:

> Depth-test coincidence — tested first by drawing with `DEPTH_TEST` disabled.
> **0.01% of pixels changed: not the cause.**

**That experiment was void.** It ran while the layer was still projecting
off-screen. Nothing was on the canvas, so nothing could be occluded, and
"disabling occlusion changes nothing" was guaranteed before it was measured. A
real number, correctly obtained, answering a question it could not reach.

It is the buffer-count mistake one level up: there the count was true and about
the wrong thing; here the control was true and **incapable of detecting the
effect it was testing for**. When a subject is later found broken, every
measurement taken against it goes back on the list — a result is only as valid
as the thing it was measured on.

Re-run against a layer that draws:

| | mean gold count | CV | mean frame-to-frame step |
|---|---|---|---|
| wireframe on | 31,835 | **15.6%** | 5,017 |
| depth test off | 50,951 | 2.3% | 1,441 |
| wireframe removed | 24,701 | 5.6% | 1,815 |

Disabling depth removes the flicker **and** draws every hidden edge — the x-ray
box, visible in the mean climbing to nearly double.

### Ruling out the render loop, which needed its own control

A custom layer misaligned with MapLibre's render loop can present partial frames,
which also reads as flashing. The discriminator is a **static camera that keeps
repainting**: depth precision is deterministic for a fixed matrix, so z-fighting
cannot show up there, while a render-loop fault would.

```
STATIC camera, forced repaints: sd 0.0 · cv 0.00%
samples: 39492 ×10 — byte-identical
```

Ruled out. The effect is matrix-dependent, which is z-fighting.

### The flicker metric had to get sharper too

At 0.06° rotation steps the count swung 15.6%, but that mixes flicker with edges
*legitimately* becoming occluded as the building turns. Dropping to **0.002°** —
a rotation too small to change the scene — the wireframe still moved 3,621
pixels a step against a control of 1,112. Nothing legitimate changes 3,621
pixels for two thousandths of a degree.

### The fix needed both levers, and each alone was wrong

- **`gl.polygonOffset` did nothing.** Tested at −2/−4, −4/−8, −8/−16 and against
  a 0/0 control: CV stayed ~15% throughout. It is the textbook fix for decals
  and it did not apply here — which is exactly why it was measured rather than
  assumed.
- **Outward offset alone** needs ~5 m before the jitter settles, and at 5 m the
  cage visibly floats off the building (`screens/70-offset3.png` shows it at 3 m).
- **Depth bias alone** needs so much that the gold count climbs toward the
  depth-disabled value — it stops flickering by punching through the mass.

Together at small values, **1.2 m outward plus 0.0009 of NDC depth bias**, the
jitter lands on the no-wireframe baseline: **CV 2.82% against a control of
3.3–4.3%**, while the mean stays at 42k against 51k for depth-off, so edges are
still being occluded properly.

### `npm run test:flicker` — the check a screenshot can never be

A still frame cannot show a flicker. The gate rotates the camera in steps too
small to change the scene and asserts the gold-pixel count does not swing:
**CV ≤ 5%**. Verified both ways — 2.82% as shipped, 7.83% with the bias removed,
exit code 1.

**Two harness bugs nearly invalidated this gate, both the same shape.** It forced
`depthBias = 0` before measuring, so it tested a configuration that does not
ship — twice, once while I was measuring the combination it was overriding. And
its first assertion was a *ratio* against the control, whose own step count
swung 646 → 1,740 between runs; the same broken build scored 2.1x and 5.7x, and
the regression passed once. It now asserts the wireframe's own CV, which
separates cleanly.

## Screenshots live in `screens/`, and are verified on disk

Seven screenshots were reported as saved to a **session temp directory** that
nobody else could open. The files existed; the path did not help anyone. Phil
looked in the repo, found nothing, and reasonably concluded they had never been
written.

They now go to `screens/` in the repo (gitignored), and the probe **stats the
file after writing it** and fails if it is under 1 KB. Same class as the push
that pushed nothing and still printed "pushed": **an artefact reported as
produced, with no check that it landed.** Report the path someone else can open,
and verify it is there.

## The map instrument (`NEXT_PUBLIC_MAP_DEBUG=1`)

Three numbers in the badge: **tiles requested / loaded**, **errors**, and **time
since the last rendered frame**. `tiles 0 · frame NEVER` states this whole
investigation in one reading, which is why it exists.

Flag-gated, but the **counters always run** — an instrument you switch on after
noticing a problem has already missed the first seconds, and load failures live
there. Two things it does deliberately: it counts **distinct tiles** rather than
`data` events (event-counting reported 48 loaded against 12 requested, and a
badge that overstates is one you would trust while chasing something else), and
its `error` handler **logs**, because registering one silences MapLibre's own
console reporting.

`window.__cid_map` is exposed under the same flag. Diagnosing this took far too
long on inference because nothing could ask the map what it thought its own
camera and sources were.

## Building groups, and 13 seeded heights (2026-08-04)

A property is a **group of masses**, not one polygon — `scripts/room-groups.mjs`
generates them and group membership is hand-authored, because "which polygons
belong to this property" is a judgement and it is what put **Bellagio Self
Parking Garage** on Bellagio.

`isRoomBuilding` still marks the containment match — which building the poker
room is *inside*, which is what hover keys on — while the group supplies the
skyline. Neither question replaces the other. Hovering any component lights the
whole property: ARIA's podium and its tower are one building to a reader.

**16 components across 8 properties carry a cited height and extrude.** Every
one has `height_source_url` + `height_fetched_at` with `height_verified_at`
NULL — candidate data, exactly like every other fact here.

| property | extruded |
|---|---|
| Wynn/Encore | Encore 192 m · Wynn 187 m |
| Venetian | Palazzo 196 m · Venetian tower 145 m |
| ARIA | tower 183 m |
| Bellagio | main tower 156 m ⚠ |
| Mandalay Bay | Delano 148 m · main tower 146 m |
| Caesars | Augustus 105 m · Julius 45 m · Nobu 45 m |
| Horseshoe | Resort Tower 83 m |
| South Point | towers 75 m |

**ARIA confirms the podium diagnosis independently.** The tower is 183 m; the
containment match was 20 m. It really was the podium — three times over.

**Two components render FLAT** — the ARIA and Caesars podiums, neither of which
has a cited height. Palace (133 m), Octavius (107 m) and Forum (71 m) now
extrude on OSM sources under the named-polygon rule above.

**Four conflicts are recorded rather than resolved:** Bellagio 156/120,
Augustus 105/111, Julius 45/52, Nobu 45/40. Where Wikipedia gives floors and OSM
gives metres, both are carried.

**Bellagio is the first entry in the verification queue.** Wikipedia says 156 m,
the OSM tag says 120 m — likely architectural vs roof height. **Both are
recorded, neither is discarded.** It is the exact disagreement this product
exists to surface, so it is carried in the data as `height_conflict` rather than
resolved by preference.

**Red Rock is NOT seeded although its ~60 m height IS cited.** No polygon in the
cache is named, so choosing one means picking the largest unnamed shape and
calling it the tower — a cited number attached to a guessed geometry, which is
the ARIA error in a new hat. **A cited height is not enough; the polygon has to
be identified too.** Same for the eight properties with uncited storey counts.

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

**The right unit is the property's BUILDING GROUP, not one polygon.** ARIA
genuinely *is* a podium with a tower on it; Caesars is a podium and four towers;
Mandalay Bay is three wings. Extruding each component at its own height is what
the building actually looks like, and it **dissolves the tension rather than
choosing a side**: containment still identifies the room's building for hover,
while the group supplies the skyline's mass. Keep the containment match and add
group membership **alongside** it — replacing one with the other loses the
question the other was answering.

This is the third appearance of the same divergence — Overpass
tallest-within-130m, then the hand-modelled massing, now containment — which is
what makes it a modelling gap rather than three separate bugs.

It does reopen the garage problem: *"which polygons belong to this property"* is
a judgement, and it is what put **Bellagio Self Parking Garage** on Bellagio. At
17 properties, verified by hand, that is tractable.

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

## Gold is in, as the ACCENT TIER (reversed 2026-08-04)

The ban is lifted, by Phil, with the reasoning intact:

> "use gold highlights throughout the website. i just didnt want to use gold and
> another color from our competitors or the poker rooms."

**The concern was never gold — it was the COMBINATION.** Gold plus a second
colour lifted from a competitor or a poker room is what makes a brand read as a
casino. Aubergine + gold is ours, and nobody else's.

**One fact on record, because it technically qualifies:** the Orleans uses
purple + gold. It is one off-Strip locals room in a Mardi Gras register rather
than a luxe one, so aubergine + gold will not read as Orleans — but Phil asked
to avoid gold plus a competitor colour, and that is the single pairing that
meets the description. Noted at the time, proceeded anyway.

### The hierarchy is the load-bearing part

- **Aubergine stays PRIMARY.** `#5E3A93` keeps the one filled action per screen,
  the mark, active nav. Unchanged.
- **Gold is the ACCENT TIER, and it is NOT on the basemap.** Highlights,
  hairlines, hover, rules, emphasis. It does the lifting **everywhere aubergine
  does nothing** —
  which is why the section eyebrows went gold and the commitment controls did
  not. An eyebrow commits to nothing; aubergine was never going to take it.
- **One filled accent per screen still holds, and still belongs to aubergine.**
  Gold may repeat. It is not the commitment colour.
- `#A98CE8` was the resting link colour *and* the value reserved for hover,
  which cannot both be true. Links moved to gold, so the reservation is now real
  and a test asserts it.

### GOLD IS NEVER SEMANTIC — the rule that keeps the rest working

- Teal `#4FBFAE` still and **only** means verified.
- **Unverified stays NEUTRAL GREY.** Do not revisit this to ochre now that gold
  is permitted. It is grey because "not yet confirmed" must read as neither a
  warning nor a decoration — and gold entering the palette makes an ochre flag
  **more** confusable, not less. A test asserts `--cid-unverified` stays neutral.
- Gold carries no state, no rank, no provenance. Decoration and identity only.
- `--cid-gold-700` is 3.9:1 on the page: **fills and hairlines only, never
  text.** A test reads the stylesheets and fails if it is used as a `color:` —
  the comment beside the token is not the enforcement.

### The map's dark tier

Aubergine land · **muted-purple** network · **indigo** water · desaturated
**moss** parks and golf. Four hues, and the second one (indigo) does the pop.

**Gold had the whole road network for one pass, and that was the mistake.** Phil:
*"with the main roads being gold its too much. maybe a different shade of purple.
more muted? the way it is currently i feel like purple is the accent color."*

That is a hierarchy problem, not a colour one. **A network is a SURFACE, and a
surface cannot be an accent** — it covers too much of the frame to read as
emphasis, so gold stopped being a highlight and aubergine ended up carrying the
accent role by default. Gold earns the accent tier by being RARE, and it is only
rare once it is off the basemap.

The map now reads as **one family in lightness steps**: land (darkest) → roads
(mid) → buildings (lightest). That is ordinary legible cartography, and the
network stops competing for attention.

**Every luminance assertion passed the whole time gold was on the roads.** The
chain — minor < casing < major < building — is a claim about brightness, and it
cannot see *how much of the screen* a colour occupies. Area was the variable
nothing measured, and it was the one that broke the hierarchy.

**`NEXT_PUBLIC_MAP_STRIP_GOLD=1`** renders the Strip alone in `--cid-gold-700`,
as a comparison. Off by default: Phil said main roads in gold is too much, and
the Strip is a main road. The filter matches `South Las Vegas Boulevard`
(highway=primary), **verified against OSM rather than guessed** — "Las Vegas
Blvd" matches nothing, and a filter that matches nothing renders an empty layer
that photographs exactly like a working one. Confirmed rendering 7 features.

**Water moved off teal entirely.** It had been a desaturated teal-slate, safe
only by carrying very little chroma — one nudge from competing with the colour
that means verified. Indigo removes the question instead of managing it: hue
does the work, so water can carry real colour and never read as a signal.

**"Nothing on the map may be green" was over-read and is now stated properly.**
What the palette bans is green meaning *good*. A park is not a claim about
anything. The test now asserts what was actually being protected — no ground
colour may be close to `--cid-value` in **both** hue and chroma — which permits
the briefed moss and would still catch a green that could pass for a signal.

**"Aubergine in the shadows, not the highlights" is superseded for roads.** Gold
is deliberately the brightest thing on the ground now. What survives is the
constraint that actually protects the view — brightness belongs to the buildings
— asserted as an ordered chain: minor < casing < major < building.

### Gold is a light hue on a dark palette, so contrast is what breaks

It breaks **per surface**, not globally, so the test walks every gold that
carries text against every surface it can land on (`ink-800/700/600/500`). Six
gold and map rules, each verified red by injection: fill-only gold used as text,
unverified drifting to ochre, the resting link taking the hover-reserved value,
gold taking a filled action, gold text too dark for a surface.

## Locked decisions worth not relitigating

- **Palette:** aubergine on ink. Accent `#5E3A93`, mark `#8A66C9`, value teal
  `#4FBFAE`, base `#0C0E11`, surface `#14171B`, paper `#F2F4F6`.
  ~~**No gold or bronze anywhere** — gold is what makes a brand read as a
  casino, and we are the independent tool.~~ **REVERSED 2026-08-04 — see
  "Gold is in" below.** The original wording is kept struck through rather than
  deleted, because the reason it was written is still the reason it is narrow
  now, and a decision that quietly disappears reads as drift the next time
  someone asks why there is gold on an audit tool.
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
