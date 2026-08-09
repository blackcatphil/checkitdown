/**
 * THE (VARIANT, STAKES) FILTER — "show my options for $2/5 NLH".
 *
 * ═══ THE CORRECTNESS TRAP, AND WHY THE KEY HAS THIS SHAPE ═══
 *
 * A room matches "$2/5 NLH" only if ONE cash_games row is BOTH $2/5 AND NLH.
 * The old `games: string[]` could not express that: it was a flat set of coarse
 * variants, so a room spreading $2/5 PLO and $1/2 NLH carried `['nlh','plo']`
 * and every stakes fact had already been thrown away by the time a filter ran.
 * Any matcher built on it would have said yes to "$2/5 NLH" for a room that has
 * never spread it — a plausible, confident, wrong answer, which is the failure
 * this product exists to not make.
 *
 * ARIA IS THE LIVE COUNTER-EXAMPLE and it is asserted by name in the probe:
 * ARIA spreads $1/2 PLO and does NOT spread $1/2 NLH. Bellagio is the positive
 * control — it genuinely spreads both $2/5 NLH and $2/5 PLO — because a
 * negative assertion alone would pass just as well against a filter that
 * matched nothing at all.
 *
 * So the key is built from a SINGLE ROW and the variant is baked into it:
 *
 *     comboKey(row) = `${row.game}::${row.stakes_label}`
 *
 * A room's combo set is one key per row it actually spreads. There is no step
 * at which the variant and the stakes are apart, so no later code CAN pair the
 * wrong two — the trap is closed by the data shape rather than by a rule
 * somebody has to remember.
 *
 * ═══ DERIVED, NEVER HARDCODED ═══
 *
 * The catalogue is computed from the rooms the map is holding, so it reacts to
 * closures and to the seasonal toggle the same way `shippableKeys` does. There
 * is no list of stakes in this file. The sort number comes off the NUMERIC
 * columns the database already stores — big_blind for blind games, big_bet for
 * fixed-limit, spread_max for the one spread game — and never off the label:
 * "$10/20" sorts after "$2/5" because 20 > 5, not because of string order,
 * which would put $10/20 second.
 *
 * ESTIMATED ROWS COUNT AS SPREAD. A tilde'd $2/5 NLH is still an option worth
 * showing; a filter is not a ranking, so the never-wins-a-superlative rule does
 * not reach here. The room page carries the tilde, as always.
 *
 * OR-WITHIN-GAMES IS NOT BUILT. Checkboxes are ANDed, as shipped everywhere
 * else in this panel — "$2/5 NLH and $1/3 NLH" means a room that spreads both.
 * "Either one" is the likely next ask and is deliberately absent: it changes
 * the meaning of every other group too, and that is a ruling, not a tweak.
 */

/** The variant sub-heads, in panel order. `game` values are the DB enum. */
export const VARIANT_ORDER = ['nlh', 'plo', 'lhe', 'stud', 'other'] as const
export type Variant = (typeof VARIANT_ORDER)[number]

export const VARIANT_LABEL: Record<Variant, string> = {
  nlh: 'NO-LIMIT HOLD’EM',
  plo: 'POT-LIMIT OMAHA',
  lhe: 'LIMIT HOLD’EM',
  stud: 'STUD',
  other: 'OTHER',
}

/** One cash_games row, as the map needs it. */
export type GameRow = {
  game: string
  stakes_label: string | null
  big_blind: number | null
  big_bet: number | null
  spread_max: number | null
}

export type Combo = {
  key: string
  variant: Variant
  label: string
  /** Numeric, off the DB columns — never parsed from `label`. */
  sort: number
  /** Rooms spreading this exact (variant, stakes). */
  rooms: number
}

type HasCombos = { combos: string[] }

/** THE ONE PLACE A KEY IS MADE. Variant and stakes, together, from one row. */
export function comboKey(game: string, stakesLabel: string): string {
  return `${game}::${stakesLabel}`
}

/** The sort number for a row, from whichever numeric column its game uses. */
export function comboSort(row: GameRow): number {
  const n = row.big_blind ?? row.big_bet ?? row.spread_max
  return n == null ? 0 : Number(n)
}

/** Every combo a room actually spreads, one key per row. Rows with no stakes
 *  label are skipped: an unlabelled row is not an option anyone can pick. */
export function roomCombos(rows: readonly GameRow[]): string[] {
  const out = new Set<string>()
  for (const r of rows) {
    if (!r.stakes_label) continue
    out.add(comboKey(r.game, r.stakes_label))
  }
  return [...out]
}

/**
 * The catalogue to render, derived from the rooms in hand.
 *
 * Grouped by variant and ordered numerically within each. A combo with no rooms
 * behind it cannot appear, for the same reason `shippableKeys` drops an empty
 * variant: a checkbox that can never match is a broken control, not an honest
 * empty state.
 */
export function comboCatalogue(
  rooms: ReadonlyArray<{ combos: string[]; comboMeta?: Record<string, { variant: string; label: string; sort: number }> }>,
): Combo[] {
  const acc = new Map<string, Combo>()
  for (const room of rooms) {
    for (const key of room.combos) {
      const meta = room.comboMeta?.[key]
      if (!meta) continue
      const hit = acc.get(key)
      if (hit) { hit.rooms++; continue }
      acc.set(key, {
        key,
        variant: (VARIANT_ORDER as readonly string[]).includes(meta.variant)
          ? (meta.variant as Variant) : 'other',
        label: meta.label,
        sort: meta.sort,
        rooms: 1,
      })
    }
  }
  return [...acc.values()].sort((a, b) =>
    VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant)
    || a.sort - b.sort
    || a.label.localeCompare(b.label))
}

/** Only keys with a room behind them may filter — same narrowing, same place. */
export function shippableCombos(rooms: ReadonlyArray<HasCombos>): Set<string> {
  const s = new Set<string>()
  for (const r of rooms) for (const k of r.combos) s.add(k)
  return s
}

/**
 * The ONLY way to apply the stakes filter.
 *
 * ANDed across checkboxes, matching the rest of the panel. `dropped` is
 * returned rather than swallowed, exactly as `applyGameFilter` does it — a key
 * silently discarded is the same class of thing as a room silently excluded
 * from a ranking.
 */
export function applyStakesFilter<T extends HasCombos>(
  rooms: readonly T[],
  checked: readonly string[],
): { matches: T[]; activeKeys: string[]; dropped: string[] } {
  const ok = shippableCombos(rooms)
  const activeKeys = checked.filter((k) => ok.has(k))
  const dropped = checked.filter((k) => !ok.has(k))
  const matches = activeKeys.length === 0
    ? [...rooms]
    : rooms.filter((r) => activeKeys.every((k) => r.combos.includes(k)))
  return { matches, activeKeys, dropped }
}
