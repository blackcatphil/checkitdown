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


/**
 * ⚠️ A SCHEDULE IS IN THE ROOM'S OWN TIME, AND THE ROOM IS IN LAS VEGAS.
 *
 * Instances are stored as `timestamptz`, so a 6 P.M. Pacific event on 17 August
 * is `2026-08-18T01:00:00Z`. Reading the date off the ISO string — `slice(0,10)`
 * — files it under the 18th, and reading the time off it shows "1 A.M.".
 *
 * That is silent and total: every evening event in the series moved to the next
 * day and the page grew a phantom date group past the end of the series. It was
 * caught by the group count being 23 against 22 dates in the database, which is
 * the only reason anybody would have noticed.
 *
 * `en-CA` because it formats as YYYY-MM-DD, which sorts.
 */
const VEGAS = 'America/Los_Angeles'
const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: VEGAS, year: 'numeric', month: '2-digit', day: '2-digit',
})
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: VEGAS, hour: '2-digit', minute: '2-digit', hour12: false,
})

/** The local date and time a timestamp falls on, in the room's own zone. */
export function vegasParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return { date: DATE_FMT.format(d), time: `${TIME_FMT.format(d)}:00` }
}
