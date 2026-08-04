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

1. **No gold, no bronze, anywhere.** Gold is what makes a brand read as a casino,
   and this product audits them.
2. **Every number carries provenance** — verified with a date, or tilde'd and
   marked unverified. Nothing is stated as fact without a real source.

Designs are authored with inline styles; the token files are the handoff contract
for the build, not a stylesheet the designs import. When producing production code,
copy the tokens in and follow the component prompts. When producing mocks, copy
assets out and write static HTML.
