# SortableHead

Two product-wide rules live in this component. Both were earned by shipped bugs.

**1. Any column offered as a sort must have a number behind it.** Strings are display
only. `verDays: 2` sorts; `"2 DAYS AGO"` sorts alphabetically and puts 10 days before 2.

**2. A sort's direction and metric are part of its claim.** The caption says which end
is best *and names what it ranks on*, and the comparator must agree. A caption
describing a superseded formula is as false as an unsorted column — a pace sort that
divided by level length silently rewarded turbos while the caption said "deepest first".

Non-sortable columns get `cursor: auto` and an explicit subhead. The difference
between a column you can act on and one you cannot must be visible without clicking.
