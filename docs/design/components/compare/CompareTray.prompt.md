# CompareTray

Appears at **two** rooms, docked bottom-left, 236 × 190 max with internal scroll past
four. Collapses to 34px; collapsed it covers zero pins.

**No hard cap on the set** — the comparison is a row filter on a 17-row table, so there
is no structural limit and inventing one would be arbitrary. The display soft-caps at
four chips with "+n more in the set".

At one room there is no tray, so the header chip must react instead: it reads
"1 ROOM TO COMPARE". An add that produces no visible change reads as a failed click.

**URL is the source of truth.** `?compare=a,b,c` is mirrored to localStorage, and
localStorage is read ONLY when the URL carries no param — otherwise a shared link
silently merges with the recipient's own set. Any non-empty set sets
`robots: noindex,follow` with a canonical back to the clean path.
