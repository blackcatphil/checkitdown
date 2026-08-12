/**
 * THREE KINDS OF ABSENCE, AND THE CONSOLE IS WRONG IF IT CONFUSES ANY TWO.
 *
 * §3.7 applied to ourselves. Every cell in the growth console is one of:
 *
 *   —                     NO PRODUCER EXISTS. Nothing feeds this and nothing
 *                         ever has. Search Console has no history; there is no
 *                         email platform; nothing fires share_link_copy.
 *   0                     A PRODUCER EXISTS AND MEASURED ZERO. Thirteen rooms
 *                         had no outbound click last week. That is a finding.
 *   first reading <date>  A PRODUCER EXISTS AND NO COMPLETE WEEK HAS ELAPSED.
 *
 * ⚠️ THE THIRD STATE IS A DATE, NOT A GLYPH, AND THE DATE IS THE WHOLE POINT.
 *
 * A labelled em-dash still reads as a dash at a glance, and — worse — it would
 * look identical if analytics stopped writing for a month. A date cannot: once
 * it has passed and the cell is still not a number, something is broken. That
 * turns a state into a deadline, and `overdue` below is the error it becomes.
 *
 * ⚠️ COMPOSITES TAKE THE WEAKEST INPUT. A loop gain with a share term that has
 * no producer is not a lower gain, it is an UNKNOWN one. Never average over an
 * absent term, and never let a pending input and an absent input produce a
 * number between them. `composite()` enforces that.
 */

/** A rendered cell. `overdue` is a fault, not a state — see `isFault`. */
export type Cell =
  | { kind: 'number'; value: number }
  | { kind: 'no-producer'; missing: string }
  | { kind: 'pending'; firstReading: Date }
  | { kind: 'overdue'; firstReading: Date; missing: string }

/** Monday of the ISO week containing `d`, in UTC. */
export function isoWeekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  /* getUTCDay: 0=Sun. ISO weeks start Monday, so Sunday is day 7. */
  const dow = x.getUTCDay() === 0 ? 7 : x.getUTCDay()
  x.setUTCDate(x.getUTCDate() - (dow - 1))
  return x
}

/**
 * When a metric needing `weeksNeeded` complete weeks can first be read.
 *
 * ⚠️ DERIVED FROM THE EARLIEST EVENT, NEVER TYPED. The first complete week is
 * the one containing the first event; it finishes the following Monday. A
 * metric needing two complete weeks (7-day return needs a prior week to return
 * FROM) waits one more.
 */
export function firstReadingOn(earliestEvent: Date, weeksNeeded: number): Date {
  const w0 = isoWeekStart(earliestEvent)
  const out = new Date(w0)
  out.setUTCDate(out.getUTCDate() + 7 * weeksNeeded)
  return out
}

/**
 * Decide what a cell shows.
 *
 * `producer` — does anything feed this metric at all? False means em-dash
 *   forever, or until somebody builds the producer.
 * `completeWeeks` — how many complete weeks the roll-up holds.
 * `weeksNeeded` — how many this metric needs.
 * `value` — what the query returned, when it could be computed.
 */
export function cellFor({
  producer, missing, earliestEvent, completeWeeks, weeksNeeded, value, now,
}: {
  producer: boolean
  missing?: string
  earliestEvent: Date | null
  completeWeeks: number
  weeksNeeded: number
  value: number | null
  now: Date
}): Cell {
  /* ⚠️ NO PRODUCER WINS OVER EVERYTHING. A metric nothing feeds cannot be
     pending — there is no date on which it starts working. Checked first so a
     missing producer can never be dressed as a deadline. */
  if (!producer) return { kind: 'no-producer', missing: missing ?? 'no producer' }

  if (completeWeeks >= weeksNeeded && value !== null) {
    /* ⚠️ 0 IS A NUMBER HERE. A producer that ran and found nothing reports
       nothing, and that is a measurement. Rendering it as an absence would
       hide the finding the console exists to surface. */
    return { kind: 'number', value }
  }

  /* Pending needs a date, and a date needs a first event. Without one there is
     no producer output at all yet — which is the absent case, not the pending
     one, however the caller described it. */
  if (!earliestEvent) return { kind: 'no-producer', missing: missing ?? 'no events yet' }

  const firstReading = firstReadingOn(earliestEvent, weeksNeeded)
  /* ⚠️ THE DEADLINE. Past its date and still not a number means the pipeline
     stopped, not that we are waiting. This is the reason the state is a date. */
  if (now >= firstReading) {
    return { kind: 'overdue', firstReading, missing: missing ?? 'expected a reading by now' }
  }
  return { kind: 'pending', firstReading }
}

/**
 * A metric computed from several others.
 *
 * ⚠️ THE WEAKEST INPUT WINS, and "weakest" means least knowable: an absent term
 * makes the whole thing unknown, a pending term makes it pending. Averaging
 * over an absent term would invent a number, which is the one thing this
 * console may not do.
 */
export function composite(parts: Cell[], compute: (values: number[]) => number): Cell {
  const absent = parts.find((p) => p.kind === 'no-producer')
  if (absent) return absent
  const overdue = parts.find((p) => p.kind === 'overdue')
  if (overdue) return overdue
  /* The LATEST pending date, because the composite cannot be read until every
     input can. */
  const pending = parts.filter((p): p is Extract<Cell, { kind: 'pending' }> => p.kind === 'pending')
  if (pending.length) {
    return pending.reduce((a, b) => (b.firstReading > a.firstReading ? b : a))
  }
  return { kind: 'number', value: compute(parts.map((p) => (p as { value: number }).value)) }
}

/** `first reading Mon 17 Aug` — the form the console prints. */
export function readingDateLabel(d: Date): string {
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()]
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return `${day[0]}${day.slice(1).toLowerCase()} ${d.getUTCDate()} ${mon}`
}

/** What a cell renders as. The console never formats a cell any other way. */
export function render(c: Cell): string {
  switch (c.kind) {
    case 'number': return String(c.value)
    case 'no-producer': return '—'
    case 'pending': return `first reading ${readingDateLabel(c.firstReading)}`
    case 'overdue': return `OVERDUE since ${readingDateLabel(c.firstReading)}`
  }
}

/** An overdue cell is a fault the page must show as one, not a quiet state. */
export const isFault = (c: Cell): boolean => c.kind === 'overdue'
