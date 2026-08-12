# Growth Engine — design bundle

## What is here

`_ds/modernist-4286b72e-…/` — the Modernist design system: `styles.css`
(the source of truth for every colour, size and rule), `readme.md`, the
manifest and the adherence lint config. 42 tokens, 35 component classes.

## What is NOT here, and needs to be

- `Growth Engine.dc.html` — the prototype markup and its logic class.
- `support.js` — the prototype runtime. Reference only; never ported.
- `screenshots/` — six full-page captures referenced by the handoff.

The design tool reported writing all of these to this folder on
2026-08-12. It had not: it wrote to its own workspace, and the zip that
reached this machine contained `_ds/` and nothing else. Only the design
system above is real. Anything built from the missing files is built
from a prose description of them.

## Rules for consuming this

- Scoped to `/admin/*` only. Never merge these tokens into
  `app/globals.css` — two token systems in one repo is how a retired
  palette survives on the icons.
- Take every value from `styles.css` variables. Do not re-derive a hex,
  a size or a rule from prose, including from any brief.
- The one CID law that outranks the system: **no data state is carried
  by colour.** Movement against a target may use the accent. Verified,
  unverified and absent may not.
