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

## Where the console diverges from Modernist, and why (2026-08-12)

The console at `/admin/growth` takes every token from
`_ds/modernist-4286b72e-…/styles.css`. Three deliberate divergences, each
because a CID law outranks the design system. `lib/modernist.test.mjs` asserts
all three and fails if any is quietly reverted.

**1. `.card-kicker` is not accent-coloured here.** The system colours a card's
kicker with `--color-accent`. On this page the kicker names *which metric* a
cell holds, which makes it a data label — and §6 forbids colour carrying a data
state. It is neutral (`--color-text` at 60%). The accent is reserved for
faults, focus, selection, links and the nav.

**2. The three absence states differ by TEXT and FORM, never by hue.** A number
is 32px at heading weight; an absence is 14px at 400. Within the absences,
`—`, `first reading Mon 17 Aug` and `OVERDUE since …` differ only by their
words. Verified in greyscale: the delta cell still reads "first reading Mon 24
Aug" with hue removed. Had the skin tinted them apart, the tint would have been
the bug.

**3. The system is scoped to `.ge`, not `:root`.** Modernist restyles bare
`body`, `h1`–`h6`, `a` and `p`, and declares its tokens on `:root`. Applied
globally that would repaint the entire product — it is a light system and the
app is dark. Everything is nested under `.ge`; `globals.css` is untouched and
`body` remains `rgb(11,15,20)` on the console route, which is asserted.

### What could not be honoured

**`.btn { justify-content: center }`.** The brief listed "everything flush left
INCLUDING button labels" as a non-negotiable *from the system*. The system does
not say that: `.btn` centres its label and only `.btn-block` is
`justify-content: flex-start`. Since the file is the source of truth, the file
wins — but the console has no buttons yet, so nothing turns on it today. Worth
settling before the Tests dialog is built, which is the first thing that needs
one.

**`.dialog-actions { justify-content: flex-end }`** has the same shape and the
same answer. Recorded now so it is a decision rather than a surprise.

### Still missing

`Growth Engine.dc.html`, `support.js` and the six screenshots. Only the cells in
the Phase 1 map are skinned; no cell was invented to fill out a layout that
cannot be seen.
