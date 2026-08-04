/**
 * THE GAME FILTER — one derivation, and the narrowing lives INSIDE it.
 *
 * The panel ships with GAMES only, and within GAMES a checkbox no room can
 * satisfy is a broken control rather than an honest one. Both of those are
 * narrowings, and a narrowing enforced at the call site is a narrowing someone
 * will forget at the next call site.
 *
 * The previous arrangement was *unreachable* rather than *impossible*: a gated
 * key could not filter invisibly only because `checked` happened never to be
 * restored from the URL or localStorage. That is a guarantee resting on a fact
 * about a different part of the code — the `is_seasonal` shape — and when that
 * elsewhere changes **nothing fails**. The broad path silently becomes
 * reachable and the only symptom is old behaviour returning.
 *
 * So the drop happens here, in the one function every caller must pass through,
 * and it REPORTS what it dropped rather than discarding silently.
 */

export type GameKey = 'nlh' | 'plo' | 'limit' | 'mixed'

export const GAME_FILTERS: ReadonlyArray<readonly [GameKey, string]> = [
  ['nlh', "No-Limit Hold'em"],
  ['plo', 'Pot-Limit Omaha'],
  ['limit', "Limit hold'em"],
  ['mixed', 'Mixed games'],
]

type HasGames = { games: string[] }

/**
 * Keys with at least one room behind them, given the CURRENT roster — so the
 * gate reacts to the seasonal toggle and to closures rather than to a constant
 * someone updates by hand.
 */
export function shippableKeys(rooms: readonly HasGames[]): Set<GameKey> {
  return new Set(
    GAME_FILTERS.map(([k]) => k).filter((k) => rooms.some((r) => r.games.includes(k))),
  )
}

/** The checkboxes to render. Same derivation the matcher uses, so the panel and
 *  the filtering can never disagree about which keys exist. */
export function visibleFilters(rooms: readonly HasGames[]) {
  const ok = shippableKeys(rooms)
  return GAME_FILTERS.filter(([k]) => ok.has(k))
}

/**
 * The ONLY way to apply the game filter.
 *
 * `dropped` is returned rather than swallowed: a key silently discarded is the
 * same class of thing as a room silently excluded from a ranking, and this
 * product names those.
 */
export function applyGameFilter<T extends HasGames>(
  rooms: readonly T[],
  checked: readonly string[],
): { matches: T[]; activeKeys: GameKey[]; dropped: string[] } {
  const ok = shippableKeys(rooms)
  const activeKeys = checked.filter((k): k is GameKey => ok.has(k as GameKey))
  const dropped = checked.filter((k) => !ok.has(k as GameKey))
  const matches = activeKeys.length === 0
    ? [...rooms]
    : rooms.filter((r) => activeKeys.every((k) => r.games.includes(k)))
  return { matches, activeKeys, dropped }
}
