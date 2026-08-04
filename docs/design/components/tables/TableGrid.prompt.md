# TableGrid — the layout contract

Ranked tables are CSS grid, one `grid-template-columns` shared by the sticky head and
every row. Two rules:

- **Every fr track is `minmax(0, Nfr)`.** Default `fr` tracks have `min-width: auto`,
  so one long room name pushes the whole page past the viewport.
- **`box-sizing: border-box` globally.** A `width: 100%` container with 20px gutters
  overflows without it — that is a 40px horizontal scrollbar on every page.

Verify by probing: `document.body.scrollWidth <= window.innerWidth`.

Row height 56px, rows separated by a 1px `rgba(242,244,246,.09)` rule — no zebra fill,
no card shells. The alignment is the aesthetic; tabular numerals on every figure.
