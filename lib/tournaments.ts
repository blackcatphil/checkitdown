/**
 * TOURNAMENT PRESENTATION — how a schedule reads, not how it is stored.
 *
 * A room publishes "Monday-Thursday, 12 p.m."; the database holds
 * `{1,2,3,4}` and `12:00:00`. These turn one into the other, and they live
 * here rather than in the page because a day-collapsing rule with runs and
 * exceptions is exactly the kind of thing that is quietly wrong for one input
 * and needs a test to say so.
 */
/** 0=Sun..6=Sat, collapsed to the way a poster writes it. The room publishes
 *  "Monday-Thursday", not a set of integers, and a reader should see the
 *  sentence rather than our storage. */
export const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export function dayLabel(days: number[] | null): string {
  if (days == null || days.length === 0) return 'ONE-OFF'
  if (days.length === 7) return 'DAILY'
  /* Contiguous runs read as a range; anything else is listed. Sunday sorts
     last here rather than first, because "SAT & SUN" is the weekend a poker
     room means and "SUN, SAT" is not a thing anybody writes. */
  const order = [1, 2, 3, 4, 5, 6, 0]
  const idx = order.filter((d) => days.includes(d))
  const runs: number[][] = []
  for (const d of idx) {
    const last = runs.at(-1)
    if (last && order.indexOf(d) === order.indexOf(last.at(-1)!) + 1) last.push(d)
    else runs.push([d])
  }
  return runs
    .map((r) => (r.length > 2 ? `${DAYS[r[0]]}–${DAYS[r.at(-1)!]}` : r.map((d) => DAYS[d]).join(' & ')))
    .join(', ')
}

/** `12:00:00` -> `12 P.M.`, the way the poster says it. */
export function timeLabel(t: string): string {
  const [h] = t.split(':').map(Number)
  const suffix = h < 12 ? 'A.M.' : 'P.M.'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh} ${suffix}`
}

