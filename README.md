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

```bash
npm run test:unit     # pure logic, no services              (6 assertions)
npm run test:rls      # pgTAP: RLS + grants, needs the stack (10 assertions)
npm run test:mixed    # rendered output, needs stack + server (63 across 15 scenarios)
```

All three are **behavioural**, because structural checks have twice passed here
while behaviour was broken: RLS policies were inert without `GRANT`s while the
schema looked flawless, and a superlative card was hardcoded to its empty state
while every test passed. Each suite has been **verified to fail** on an injected
regression — a suite that has never been red is a suite nobody has tested.

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
