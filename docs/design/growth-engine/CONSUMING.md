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
