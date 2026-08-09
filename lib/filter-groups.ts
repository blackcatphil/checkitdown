/**
 * WHICH FILTER GROUPS ARE OPEN — the resolver, as a pure function.
 *
 * ═══ THE DEFAULT IS MEASURED, NOT GUESSED (2026-08-09) ═══
 *
 * With every group open the panel is 2500px of content against 836px of
 * visible desktop panel and 522px of phone sheet. The five stakes sub-heads
 * are 1378px of that — 55% — because 26 combos is 26 rows however tidily they
 * are grouped. Collapsing exactly those five takes the desktop panel to 1122px
 * and the phone sheet to 1151px. GAMES and the amenity groups stay open: they
 * are short and coarse, they are what a first-time reader reaches for, and the
 * overflow was never theirs.
 *
 * ONE RULE, BOTH PLATFORMS. A phone sheet and a 302px desktop panel have
 * different amounts of room, but they do not have different filters, and a
 * panel that remembers a different shape per viewport is a panel that surprises
 * anyone who uses both.
 *
 * ═══ AN ACTIVE SELECTION OPENS ITS GROUP, WHATEVER THE DEFAULT ═══
 *
 * This is the load-time half of the invisible-filter trap. A collapsed group
 * that is quietly filtering is the failure the count on the head answers while
 * a reader is looking; this answers it for a reader who has just arrived and
 * never saw the click.
 *
 * IT HAS NO LIVE PATH IN THE PRODUCT TODAY, and that is worth saying plainly
 * rather than dressing a browser assertion over: checked filters are session
 * state, not URL state (ruled the same day — collapse is chrome, and so is
 * this), so a fresh load has nothing checked and the branch never fires. It is
 * here as the guard for the day a filter does persist, and it is asserted at
 * unit level, where the claim is actually decidable, instead of in a probe that
 * could only ever exercise the reachable half.
 *
 * A USER'S CHOICE BEATS BOTH. Once someone has toggled a group, that is the
 * answer — including collapsing one that is filtering, which is allowed and
 * which never clears the selection. `id in userOpen` rather than a truthiness
 * check, so a deliberate `false` is not read as "no opinion".
 */

/** Stakes variants start closed; every other group starts open. */
export function defaultOpen(id: string): boolean {
  return !id.startsWith('stakes:')
}

/**
 * Is this group open? `userOpen` is the session-local record of what the reader
 * has toggled — deliberately not persisted and deliberately not in the URL.
 */
export function resolveOpen(
  id: string,
  activeCount: number,
  userOpen: Readonly<Record<string, boolean>>,
): boolean {
  if (id in userOpen) return userOpen[id]
  return defaultOpen(id) || activeCount > 0
}

/** The next `userOpen` after a click on `id`, given what it resolves to now. */
export function toggleOpen(
  id: string,
  activeCount: number,
  userOpen: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  return { ...userOpen, [id]: !resolveOpen(id, activeCount, userOpen) }
}
