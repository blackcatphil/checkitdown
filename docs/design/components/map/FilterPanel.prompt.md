# FilterPanel

302px, persistent, left of the map — not a dropdown and not a sheet. Sixteen checkboxes
in five groups, each carrying a live count, combined with AND.

The counter is the honest part: "9 of 17 rooms match". When it reaches zero, say so and
offer the clear — never show an empty map and let the user infer a bug.

The empty state of the compare set lives here too, as a block explaining the loop,
which flips to the populated set once a room is added.
