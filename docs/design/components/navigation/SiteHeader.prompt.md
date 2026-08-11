# SiteHeader

64px, sticky, `#121820`, closed by a 1px gold hairline `rgba(227,197,103,.34)` — the
one geometry where gold is decoration by construction rather than by discipline: it
marks the boundary and claims nothing.

Left: the knock lockup, then MAP / JUST THE FACTS / TOURNAMENTS / PROMOS in mono at
.16em. The active item is **weight and full-strength ink**, never a wash and never a
hue — the same rule the bottom nav's active item carries. Right:
`VERIFIED DAILY \u00b7 INDEPENDENT`.

That right-hand line is the product's claim, not decoration — but it IS what goes at
the phone breakpoint, because below 860px the header drops its nav entirely and the
bottom bar carries those four destinations. Two navs on a 390px screen is two answers
to "where am I".

Verify the header fits by probing `el.scrollWidth === el.clientWidth` in every state,
including with a compare chip present. All four links `nowrap` in a row that could not
shrink is what put 494px of scroll width on every page at 390px.
