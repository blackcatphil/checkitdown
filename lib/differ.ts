/**
 * THE DIFFER — parse, diff, and decide. No I/O, no database, no network.
 *
 * The scheduled job (scripts/differ.mjs) fetches, then hands the bytes here,
 * then applies what comes back through `approve_change`. This split is not
 * tidiness: the parse is the part that will meet a document somebody reformatted
 * on a Tuesday, and it has to be testable against fixtures rather than against
 * a live Google Doc nobody can reach from CI.
 *
 * ═══ WHAT THIS DOES NOT DO ═══
 *
 * It does not decide whether a write is allowed. Precedence lives in the
 * database (migration 008) and is enforced there, on every path, including the
 * ones nobody has written yet. A differ that pre-filtered by precedence would
 * be a second copy of the law, and the second copy is the one that goes stale.
 * So this proposes; the database refuses; the job counts the refusals.
 */

/** One fact read out of a source document. */
export type IncomingFact = {
  roomSlug: string
  /** `rooms` fields, or a cash_games row identified by its stakes label. */
  table: 'rooms' | 'cash_games'
  /** Which cash_games row — null for a room-level fact. */
  stakesLabel: string | null
  field: string
  /** JSON-shaped: string, number, or null to clear. */
  value: string | number | null
}

export type UnparsedLine = {
  line: number
  raw: string
  why: string
}

export type ParseResult = {
  facts: IncomingFact[]
  unparsed: UnparsedLine[]
}

/**
 * RFC4180-ish CSV. Quoted fields, doubled quotes inside them, CRLF or LF.
 *
 * Hand-rolled rather than split(',') because a rake note reading
 * `10%, capped at $6` is one field and a naive split turns it into two — which
 * would not throw, would not warn, and would shift every column after it by
 * one. That is the failure mode this repo keeps finding: plausible output with
 * nothing to catch it.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  /* A file with no trailing newline still has a last row. */
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** The columns a source sheet must carry. Order is not assumed — headers are. */
const REQUIRED = ['room', 'field', 'value'] as const

/** Fields the differ is allowed to write. An ALLOWLIST, so a new column in a
 *  partner sheet is reported as unparsed rather than written blind. */
export const WRITABLE_FIELDS: Record<string, 'rooms' | 'cash_games'> = {
  table_count: 'rooms',
  hours_note: 'rooms',
  phone: 'rooms',
  comp_rate_hourly: 'rooms',
  rake_type: 'cash_games',
  rake_percent: 'cash_games',
  rake_cap: 'cash_games',
  jackpot_drop: 'cash_games',
  min_buy_in: 'cash_games',
  max_buy_in: 'cash_games',
}

/** Fields that must move together — see approve_change_group. */
export const RAKE_GROUP = new Set(['rake_type', 'rake_percent', 'rake_cap', 'jackpot_drop'])

const NUMERIC = new Set([
  'table_count', 'comp_rate_hourly', 'rake_percent', 'rake_cap',
  'jackpot_drop', 'min_buy_in', 'max_buy_in',
])

/**
 * Turn parsed CSV into facts, reporting everything it could not read.
 *
 * NOTHING IS GUESSED. An unknown field, an unknown room, a number that is not a
 * number — each becomes an `unparsed` line with a reason, and the job prints
 * them. The alternative is a differ that silently ignores a column somebody
 * renamed and reports "0 changes" for a month.
 */
export function toFacts(rows: string[][], knownSlugs: ReadonlySet<string>): ParseResult {
  const facts: IncomingFact[] = []
  const unparsed: UnparsedLine[] = []
  if (rows.length === 0) return { facts, unparsed }

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const missing = REQUIRED.filter((r) => !header.includes(r))
  if (missing.length > 0) {
    return {
      facts,
      unparsed: [{ line: 1, raw: rows[0].join(','), why: `header is missing: ${missing.join(', ')}` }],
    }
  }
  const at = (r: string[], name: string) => {
    const i = header.indexOf(name)
    return i === -1 ? '' : (r[i] ?? '').trim()
  }

  for (let n = 1; n < rows.length; n++) {
    const r = rows[n]
    const line = n + 1
    const raw = r.join(',')
    const roomSlug = at(r, 'room')
    const field = at(r, 'field')
    const rawValue = at(r, 'value')
    const stakesLabel = at(r, 'stakes') || null

    if (!knownSlugs.has(roomSlug)) {
      unparsed.push({ line, raw, why: `unknown room "${roomSlug}"` }); continue
    }
    const table = WRITABLE_FIELDS[field]
    if (table == null) {
      unparsed.push({ line, raw, why: `field "${field}" is not writable by the differ` }); continue
    }
    /* A cash_games fact without a stakes label cannot be aimed at a row. */
    if (table === 'cash_games' && stakesLabel == null) {
      unparsed.push({ line, raw, why: `field "${field}" needs a stakes column to say which game` }); continue
    }

    let value: string | number | null
    if (rawValue === '' || rawValue.toLowerCase() === 'null') {
      value = null
    } else if (NUMERIC.has(field)) {
      /* Strip a currency mark and thousands separators, then require a NUMBER.
         "$6" and "6" are the same figure; "about 6" is not a figure. */
      const cleaned = rawValue.replace(/[$,\s]/g, '')
      const num = Number(cleaned)
      if (cleaned === '' || !Number.isFinite(num)) {
        unparsed.push({ line, raw, why: `"${rawValue}" is not a number for ${field}` }); continue
      }
      value = num
    } else {
      value = rawValue
    }

    facts.push({ roomSlug, table, stakesLabel, field, value })
  }
  return { facts, unparsed }
}

/** A fact as the database currently holds it. */
export type CurrentFact = {
  roomSlug: string
  table: 'rooms' | 'cash_games'
  stakesLabel: string | null
  field: string
  value: string | number | null
  targetId: string
}

export type Change = IncomingFact & { targetId: string; from: string | number | null }

export type DiffResult = {
  changes: Change[]
  /** Facts whose target row does not exist — reported, never invented. */
  noTarget: IncomingFact[]
  /** How many incoming facts already matched. Printed so "0 changes" is
   *  distinguishable from "read nothing". */
  unchanged: number
}

const key = (f: { roomSlug: string; table: string; stakesLabel: string | null; field: string }) =>
  `${f.roomSlug}::${f.table}::${f.stakesLabel ?? ''}::${f.field}`

/** Loose equality across the text/numeric boundary — the database hands back
 *  `6.00` for a numeric column and a sheet says `6`. Compared as numbers when
 *  both sides look numeric, so a differ does not propose a no-op every night. */
export function sameValue(a: string | number | null, b: string | number | null): boolean {
  if (a == null || b == null) return a == null && b == null
  const na = Number(String(a).replace(/[$,\s]/g, ''))
  const nb = Number(String(b).replace(/[$,\s]/g, ''))
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na === nb
  }
  return String(a).trim() === String(b).trim()
}

export function diff(incoming: readonly IncomingFact[], current: readonly CurrentFact[]): DiffResult {
  const byKey = new Map(current.map((c) => [key(c), c]))
  const changes: Change[] = []
  const noTarget: IncomingFact[] = []
  let unchanged = 0

  for (const f of incoming) {
    const cur = byKey.get(key(f))
    if (cur == null) { noTarget.push(f); continue }
    if (sameValue(cur.value, f.value)) { unchanged++; continue }
    changes.push({ ...f, targetId: cur.targetId, from: cur.value })
  }
  return { changes, noTarget, unchanged }
}

/**
 * Group changes so a rake model and its figures reach the database together.
 *
 * Returns batches; a batch with more than one member goes to
 * `approve_change_group`, which orders them so no intermediate row violates
 * `rake_model_coherent`. Singles go to `approve_change` as before.
 */
export function batch(changes: readonly Change[]): Change[][] {
  const rake = new Map<string, Change[]>()
  const singles: Change[][] = []
  for (const c of changes) {
    if (c.table === 'cash_games' && RAKE_GROUP.has(c.field)) {
      const k = c.targetId
      const list = rake.get(k)
      if (list) list.push(c)
      else rake.set(k, [c])
    } else {
      singles.push([c])
    }
  }
  return [...rake.values(), ...singles]
}
