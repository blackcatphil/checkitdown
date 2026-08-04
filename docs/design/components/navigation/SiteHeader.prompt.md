# SiteHeader

64px, sticky, `#14171B`. Left: the knock lockup, then MAP / JUST THE FACTS /
TOURNAMENTS / PROMOS in mono at .16em, the active one in `#A98CE8` on an aubergine
wash. Right: `VERIFIED DAILY \u00b7 INDEPENDENT`.

That right-hand line is the product's claim, not decoration — it does not get dropped
at narrow widths. Verify the header fits by probing
`el.scrollWidth === el.clientWidth` in every state, including with a compare chip present.
