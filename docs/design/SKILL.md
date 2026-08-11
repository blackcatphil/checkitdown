---
name: check-it-down-design
description: Use this skill to design or build any Check It Down surface — the independent Las Vegas poker room map, rankings, tournaments and promotions product at checkitdown.com. Contains the locked palette, type scale, layout tokens, motion, and the desktop component set, plus the provenance and ranking rules that govern every number on screen.
user-invocable: true
---

Read `readme.md` in this skill first — it carries the rules that are easy to get
wrong and expensive to get wrong. Then explore `tokens/`, `components/` and
`guidelines/`.

CHECK IT DOWN is desktop-first (mobile deferred but coming), dark by default,
and independent of the casinos it covers. Two constraints override everything:

1. **No data state is carried by colour.** Gold is decorative and carries no data
   meaning — rules, hairlines, eyebrows, mark rings — and never fills a surface.
   Verified is a mark and a date; the true #1 is weight, size and full-strength
   ink; unverified is `#8FA2B8` with a tilde and a dotted rule. No ochre, amber
   or red as caution: all three collide with the brand's own gold. (This
   replaced "no gold anywhere" when the aubergine palette was retired on
   2026-08-09 — the reason survived, the banned hue did not.)
2. **Every number carries provenance** — verified with a date, or tilde'd and
   marked unverified. Nothing is stated as fact without a real source. The
   canonical colour source is `app/styles/tokens/colors.css`, not the design-side
   copy.

Designs are authored with inline styles; the token files are the handoff contract
for the build, not a stylesheet the designs import. When producing production code,
copy the tokens in and follow the component prompts. When producing mocks, copy
assets out and write static HTML.
