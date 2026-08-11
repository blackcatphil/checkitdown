# Check It Down

**[checkitdown.com](https://checkitdown.com)** — a desktop-first map of every
poker room in the Las Vegas valley: games, rake, amenities, promotions and
tournaments, ranking who is best at what. Independent of the casinos it covers.

**Every fact carries a source and a verified date.** Nothing is stated as fact on
the strength of a web search — data enters as *candidate data* with
`source_url` and `fetched_at`, and `verified_at` stays NULL until a human
confirms it on site. Unverified figures are shown, tilde'd, and never ranked.

> **Status: pre-launch.** The schema is applied and exercised, 17 rooms are
> seeded as candidate data, and **zero rows are verified** — so nothing on the
> site is ranked yet. That is the intended state, not a gap.

## Docs

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | **Start here.** Where things stand, the build order, and the locked decisions — including the rules this project learned the hard way |
| [`docs/design/`](docs/design/) | The design system, the six built surfaces, and the current design brief |
| [`supabase/migrations/`](supabase/migrations/) | The schema, heavily commented with *why* |
| [`supabase/seed.sql`](supabase/seed.sql) | The 17-room research pass, with every conflict and how it was adjudicated |

## Local development

```bash
npm install
supabase start          # needs a container runtime (OrbStack or Docker)
cp .env.example .env.local   # fill in the anon key supabase start prints
npm run dev
```

## Tests

Nine suites, all of them **behavioural**. Structural checks have three times
passed here while behaviour was broken: RLS policies were inert without `GRANT`s
while the schema looked flawless, a superlative card was hardcoded to its empty
state while every test passed, and **the map drew nothing for weeks** while the
markup, the canvas element and the console were all exactly what a working map
produces. Each suite has been **verified to fail** on an injected regression — a
suite that has never been red is a suite nobody has tested.

| Suite | What it measures | Needs |
|---|---|---|
| `test:unit` | Pure logic: ranking, provenance, the rake and floor-sheet parses, the QR encoder and its decoder, tournament terms and filters, and the two hand transcriptions of the Wynn dailies diffed against each other | nothing |
| `test:rls` | pgTAP against the real roles: row-level security, the `GRANT`s policies are inert without, the precedence law cell by cell, and every schema constraint including the ones that refuse an incoherent buy-in | the stack |
| `test:prose` | The **daily production write path**, driven end to end: a description inserts, an identical re-run writes nothing at all, and changed text replaces rather than duplicates | the stack |
| `test:mixed` | Rendered output after mutating the database — the mixed verified/unverified state that is the real production condition, and the only place several ranking rules meet | stack + server |
| `test:auth` | A real magic-link sign-in through the app's own callback, `is_admin` over HTTP, and the open-redirect spellings by name | stack + server |
| `test:map` | The map **in a browser**: did it request tiles — the one signal that separates a working map from a dead one | browser |
| `test:mobile` | The phone layout at 390px: overflow, 44px targets, the bottom nav, and the entry camera at four real Safari viewport heights | browser + stack |
| `test:pwa` | Installable, the service worker refusing to cache a fact, and the install QR **decoded back out of the rendered pixels** | browser |
| `test:palette` | Every text node's contrast with `opacity` composited down the ancestor chain, and the one-filled-action ceiling | browser |

**No assertion counts are printed here on purpose.** They were `13`, `10`, `65`
and `8` in this table while the suites actually ran fifteen to twenty times
that — a number in prose is a number nobody updates, and a stale one is worse
than none because it reads as a measurement. The counts that matter are the
**floors in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)**, which are
asserted on every run: a suite that shrinks fails there rather than passing
quietly. To see today's numbers, run the suite.

Two suites run **twice** in CI, in two jobs:

- the **shipping configuration**, which is what readers get, and
- a **debug build** with `NEXT_PUBLIC_MAP_DEBUG=1`, which exposes
  `window.__cid_map` and recovers the assertions that read the live map —
  rendered building masses, camera readings, the four-viewport skyline sweep and
  the feature-state filter pair.

The flagless job is the authority on what ships. The debug job exists because
those assertions were otherwise verified only by hand: the first time they were
actually executed, two of them had been red for two days.

`test:map`, `test:mobile`, `test:pwa` and `test:palette` need a browser —
`npx playwright install chromium`.

### The ingests

`npm run ingest:tournaments` (Wynn) and
`python3 scripts/tournaments/ingest.py orleans` read published documents and
write to whatever `DATABASE_URL` they are given. **Both are dry-run by default**;
`INGEST_APPLY=1` is the only thing that changes it. Each verifies inside its own
transaction — a run that cannot assert its expected counts rolls back rather
than leaving the database half-written — and then reads the same assertions back
over a fresh connection.

`npm run census:prod` asks **production** whether it holds what the seed says it
does. It exists because the Wynn tournaments once passed every gate and reached
production as zero rows: CI was green because CI reseeds.

## A note on the `ci-selftest/*` branches

They contain **deliberately broken code** and are kept on purpose. Each injects
one regression — a revoked `GRANT`, a hardcoded empty superlative, a filter key
that should have been dropped — to prove the matching CI gate goes red, and red
*for the right reason*. A pipeline that has never been red is a pipeline nobody
has tested, and that failure is invisible for months because green is what you
expect to see.

**Nothing on `main` is broken.** If you landed on one of those branches, that is
the branch doing its job.

## Licence

Not yet licensed. All rights reserved pending a decision.
