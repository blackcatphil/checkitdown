/**
 * THE FOUR WYNN DAILIES EXIST TWICE, AND THIS IS HOW THE PAIR IS GATED.
 *
 * `supabase/seed.sql` transcribes them and `scripts/tournaments/wynn.py`
 * declares them again. Both are hand transcriptions of the same poster, they
 * were verified equal on 2026-08-11 by diffing two databases, and that was a
 * check somebody ran rather than a check that runs.
 *
 * ═══ WHY BOTH COPIES STAY ═══
 *
 * The obvious fix is to delete one. Neither deletion works:
 *
 *   THE SEED CANNOT SOURCE FROM THE INGEST. `wynn.py` fetches live PDFs over
 *   the network and parses them. `supabase db reset` must work on a plane, in
 *   CI with no egress, and on the day Wynn's CDN is down — a seed that reaches
 *   the internet is a seed that fails for reasons unrelated to the schema, and
 *   it takes every RLS and mixed-state gate down with it.
 *
 *   THE INGEST CANNOT SOURCE FROM THE SEED. `seed.sql` does not reach
 *   production; the ingest is the only path that does. That is the whole reason
 *   the dailies were re-declared there.
 *
 * So the ruling is: keep both, and make them prove they agree. That is this
 * file — two parsers, one for each copy, producing the same normalised shape.
 *
 * ═══ THE PARSERS REFUSE WHAT THEY DO NOT UNDERSTAND ═══
 *
 * The failure mode a comparison like this actually dies of is not disagreement.
 * It is a parser that quietly stops finding one side — reads zero rows, or
 * silently drops the column somebody just changed — and reports agreement
 * between two things it never looked at. Every unknown expression below throws
 * by name rather than being skipped, and the test asserts the row and column
 * counts before it compares a single value.
 */

export type Daily = {
  slug: string
  name: string
  game: string
  startTime: string
  days: number[]
  entry: number
  fee: number
  staff: number
  guarantee: number
  startingStack: number
  levelMinutes: number
  lateRegLevel: number
  reentryAllowed: boolean
  reentryNote: string
  /* Migration 014. Nullable, and the nulls are load-bearing: `rebuyChips` is
     null because Wynn never publishes what a rebuy buys, and `rebuyMax` is null
     because "unlimited" is a separate claim rather than an absent count. */
  rebuyAmount: number | null
  rebuyChips: number | null
  rebuyMax: number | null
  rebuyUnlimited: boolean
  rebuyMaxStack: number | null
  rebuyWindow: string | null
  addonAmount: number | null
  addonChips: number | null
  addonMax: number | null
  addonWindow: string | null
  structurePdfUrl: string
  documentEffectiveOn: string
  documentDateSource: string
  sourceUrl: string
}

/**
 * THE TWO COLUMNS DELIBERATELY NOT COMPARED, named here rather than omitted
 * quietly. `structure_fetched_at` and `fetched_at` are WHEN THE DOCUMENT WAS
 * READ. The seed pins a timestamp because a seed has to be reproducible; the
 * ingest stamps the moment it runs, because that is the truth for a live fetch.
 * They are supposed to differ, and a test that demanded they match would be
 * asserting that the ingest is a seed.
 */
export const NOT_COMPARED = ['structure_fetched_at', 'fetched_at'] as const

/** Field name in the normalised shape for each database column. */
const COLUMN_TO_FIELD: Record<string, keyof Daily> = {
  slug: 'slug',
  name: 'name',
  game: 'game',
  start_time: 'startTime',
  days_of_week: 'days',
  entry_amount: 'entry',
  fee_amount: 'fee',
  staff_amount: 'staff',
  guarantee_amount: 'guarantee',
  starting_stack: 'startingStack',
  level_minutes: 'levelMinutes',
  late_reg_level: 'lateRegLevel',
  reentry_allowed: 'reentryAllowed',
  reentry_note: 'reentryNote',
  rebuy_amount: 'rebuyAmount',
  rebuy_chips: 'rebuyChips',
  rebuy_max: 'rebuyMax',
  rebuy_unlimited: 'rebuyUnlimited',
  rebuy_max_stack: 'rebuyMaxStack',
  rebuy_window: 'rebuyWindow',
  addon_amount: 'addonAmount',
  addon_chips: 'addonChips',
  addon_max: 'addonMax',
  addon_window: 'addonWindow',
  structure_pdf_url: 'structurePdfUrl',
  document_effective_on: 'documentEffectiveOn',
  document_date_source: 'documentDateSource',
  source_url: 'sourceUrl',
}

/* ── Shared lexing ────────────────────────────────────────────────────────
   Both copies are comma-separated lists containing quoted strings that hold
   commas and brackets of their own. Splitting on /,/ works on neither. */

/**
 * ⚠️ COMMENTS ARE STRIPPED BEFORE ANYTHING IS SPLIT, and this is not tidiness.
 *
 * Migration 014 added a `--` comment INSIDE a VALUES tuple in the seed, saying
 * that 15,000 is an eligibility threshold rather than chips received. That
 * comment contains "15,000" — a comma — and a double quote. Both are invisible
 * to a reader and both are structure to a splitter: the comma added a phantom
 * tuple member and the quote flipped the lexer into string mode for the rest of
 * the file. The result was a refusal, which is the right failure, but the cause
 * is a trap anybody documenting a column would step in again.
 *
 * Quote-aware, because `--` and `#` appear inside real string literals: a URL
 * fragment, an em-dash sentence. Stripping them textually would corrupt the
 * values this file exists to compare.
 */
export function stripLineComments(src: string, marker: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      out += c
      if (c === '\\') { out += src[i + 1] ?? ''; i++; continue }
      if (c === quote) {
        if (c === "'" && src[i + 1] === "'") { out += src[i + 1]; i++; continue }
        quote = null
      }
      continue
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue }
    if (src.startsWith(marker, i)) {
      const nl = src.indexOf('\n', i)
      if (nl < 0) break
      /* The newline is kept so line-anchored patterns still work. */
      out += '\n'
      i = nl
      continue
    }
    out += c
  }
  return out
}

/** Split at commas that are not inside a string, bracket, brace or paren. */
export function splitTop(src: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) {
        /* SQL escapes a quote by doubling it. */
        if (c === "'" && src[i + 1] === "'") { i++; continue }
        quote = null
      }
      continue
    }
    if (c === "'" || c === '"') { quote = c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) { out.push(src.slice(start, i)); start = i + 1 }
  }
  const tail = src.slice(start)
  if (tail.trim() !== '') out.push(tail)
  return out.map((s) => s.trim())
}

/**
 * Read a value that both languages spell almost the same way.
 *
 * ADJACENT STRING LITERALS ARE JOINED, which is not a nicety: the rebuy note is
 * written as two literals on two lines in BOTH files — SQL concatenates them by
 * juxtaposition and so does Python — and a reader that took only the first half
 * would compare two truncated sentences and find them equal.
 */
export function readValue(raw: string, where: string): string | number | boolean | number[] | null {
  let s = raw.trim()

  /* Type decorations that carry no value: ::game_kind, ::smallint[], and the
     `time` / `date` / `timestamptz` literal prefixes. */
  s = s.replace(/::\s*[a-z_]+(\s*\[\s*\])?/gi, '').trim()
  s = s.replace(/^(?:time|date|timestamptz|timestamp)\s+(?=')/i, '').trim()

  /* ABSENCE IS A VALUE HERE and must survive the comparison. SQL spells it
     `null` (often as `null::numeric`, stripped above) and Python spells it
     `None`; both mean "the room does not publish this", and migration 014
     turned that into a fact worth diffing — `rebuy_chips` is null on all four
     Wynn dailies precisely BECAUSE the poster never says what $200 buys. */
  if (/^(null|none)$/i.test(s)) return null

  if (/^true$/i.test(s)) return true
  if (/^false$/i.test(s)) return false

  /* array[1,2,3] (SQL) and [1, 2, 3] (Python). */
  const arr = s.match(/^(?:array)?\s*\[([^\]]*)\]$/i)
  if (arr) {
    const items = arr[1].split(',').map((x) => x.trim()).filter((x) => x !== '')
    const nums = items.map((x) => Number(x))
    if (nums.some((n) => Number.isNaN(n))) throw new Error(`${where}: non-numeric array member in ${raw}`)
    return nums
  }

  if (s.startsWith("'")) {
    /* One or more adjacent literals, possibly separated by newlines. */
    let out = ''
    let i = 0
    let read = 0
    while (i < s.length) {
      if (/\s/.test(s[i])) { i++; continue }
      if (s[i] !== "'") break
      i++
      let buf = ''
      for (; i < s.length; i++) {
        if (s[i] === '\\') { buf += s[i + 1]; i++; continue }
        if (s[i] === "'") {
          if (s[i + 1] === "'") { buf += "'"; i++; continue }
          i++
          break
        }
        buf += s[i]
      }
      out += buf
      read++
    }
    if (read === 0) throw new Error(`${where}: unreadable string ${raw}`)
    if (s.slice(i).trim() !== '') throw new Error(`${where}: trailing text after string in ${raw}`)
    return out
  }

  const n = Number(s)
  if (!Number.isNaN(n) && s !== '') return n
  throw new Error(`${where}: cannot read value ${JSON.stringify(raw)}`)
}

/** Everything between the matching brackets that begins at `from`. */
function balanced(src: string, from: number, open: string, close: string, where: string): string {
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) {
        if (c === "'" && src[i + 1] === "'") { i++; continue }
        quote = null
      }
      continue
    }
    if (c === "'" || c === '"') { quote = c; continue }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return src.slice(from + 1, i)
    }
  }
  throw new Error(`${where}: unbalanced ${open}${close} from index ${from}`)
}

/* ── The seed ─────────────────────────────────────────────────────────── */

/**
 * The dailies block in `supabase/seed.sql`.
 *
 * Identified by being the `tournament_templates` insert with NO `series_id` in
 * its column list — the series block is the other one, has 61 rows, and would
 * otherwise be matched by any looser anchor.
 */
export function dailiesFromSeed(raw: string): { rows: Daily[]; columns: string[] } {
  const sqlText = stripLineComments(raw, '--')
  const starts: number[] = []
  const re = /insert\s+into\s+tournament_templates\s*\(/gi
  for (let m = re.exec(sqlText); m; m = re.exec(sqlText)) starts.push(m.index + m[0].length - 1)
  if (starts.length === 0) throw new Error('seed: no tournament_templates insert found')

  const blocks = starts.map((at) => ({ at, cols: splitTop(balanced(sqlText, at, '(', ')', 'seed columns')) }))
  const daily = blocks.filter((b) => !b.cols.includes('series_id'))
  if (daily.length !== 1) {
    throw new Error(`seed: expected exactly one tournament_templates insert without series_id, found ${daily.length}`)
  }
  const columns = daily[0].cols

  /* The SELECT list runs from `select` to the `from rooms` that follows it. */
  const afterCols = sqlText.indexOf(')', daily[0].at) + 1
  const selAt = sqlText.toLowerCase().indexOf('select', afterCols)
  const fromAt = sqlText.toLowerCase().indexOf('from rooms', selAt)
  if (selAt < 0 || fromAt < 0) throw new Error('seed: could not locate the select list')
  const selects = splitTop(sqlText.slice(selAt + 'select'.length, fromAt))
  if (selects.length !== columns.length) {
    throw new Error(`seed: ${columns.length} columns but ${selects.length} select expressions`)
  }

  /* The VALUES tuples and the alias that names their fields. */
  const valuesAt = sqlText.toLowerCase().indexOf('(values', fromAt)
  if (valuesAt < 0) throw new Error('seed: no (values ...) list')
  const valuesBody = balanced(sqlText, valuesAt, '(', ')', 'seed values')
  const aliasAt = sqlText.indexOf('as v(', valuesAt + valuesBody.length)
  if (aliasAt < 0) throw new Error('seed: no `as v(...)` alias — the tuple fields are unnamed')
  const aliasFields = splitTop(balanced(sqlText, aliasAt + 'as v'.length, '(', ')', 'seed alias'))

  const tuples = splitTop(valuesBody.replace(/^\s*values/i, ''))
    .map((t) => t.trim())
    .filter((t) => t.startsWith('('))
  if (tuples.length === 0) throw new Error('seed: the values list parsed to zero tuples')

  const rows: Daily[] = []
  for (const tuple of tuples) {
    const parts = splitTop(tuple.slice(1, -1))
    if (parts.length !== aliasFields.length) {
      throw new Error(`seed: a tuple has ${parts.length} members against ${aliasFields.length} alias fields`)
    }
    const v: Record<string, unknown> = {}
    aliasFields.forEach((f, i) => { v[f] = readValue(parts[i], `seed tuple ${f}`) })

    const row: Partial<Daily> = {}
    columns.forEach((col, i) => {
      if ((NOT_COMPARED as readonly string[]).includes(col)) return
      if (col === 'room_id') return
      const field = COLUMN_TO_FIELD[col]
      if (!field) throw new Error(`seed: column ${col} has no place in the compared shape`)
      const expr = selects[i].trim()
      if (/^v\.[a-z_]+$/i.test(expr)) {
        const key = expr.slice(2)
        if (!(key in v)) throw new Error(`seed: select references v.${key}, which the alias does not name`)
        row[field] = v[key] as never
      } else {
        row[field] = readValue(expr, `seed select ${col}`) as never
      }
    })
    rows.push(row as Daily)
  }
  return { rows, columns }
}

/* ── The ingest ───────────────────────────────────────────────────────── */

/** A `NAME = (...)` or `NAME = '...'` module constant, adjacent literals joined. */
function pyConstant(py: string, name: string): string {
  const at = py.search(new RegExp(`^${name}\\s*=\\s*`, 'm'))
  if (at < 0) throw new Error(`ingest: constant ${name} not found`)
  const eq = py.indexOf('=', at)
  const rest = py.slice(eq + 1).replace(/^[ \t]*/, '')
  const body = rest.startsWith('(')
    ? balanced(rest, 0, '(', ')', `ingest ${name}`)
    : rest.slice(0, rest.indexOf('\n'))
  const value = readValue(body, `ingest ${name}`)
  if (typeof value !== 'string') throw new Error(`ingest: ${name} is not a string`)
  return value
}

/**
 * The four `dict(...)` declarations in `DAILIES`, plus the template around them.
 *
 * ⚠️ THE TEMPLATE MATTERS AS MUCH AS THE DICTS. Four of the eighteen compared
 * columns — game, starting_stack, document_date_source and both URLs — are not
 * in the dicts at all; they are literals and constants inside the f-string that
 * builds the INSERT. Comparing only the dicts would leave `25000` on one side
 * and `20000` on the other, agreeing perfectly on the twelve fields it looked
 * at.
 */
export function dailiesFromIngest(raw: string): { rows: Daily[]; columns: string[] } {
  const py = stripLineComments(raw, '#')
  const at = py.search(/^DAILIES\s*=\s*\[/m)
  if (at < 0) throw new Error('ingest: DAILIES not found')
  const listBody = balanced(py, py.indexOf('[', at), '[', ']', 'ingest DAILIES')
  const entries = splitTop(listBody).filter((e) => e.startsWith('dict('))
  if (entries.length === 0) throw new Error('ingest: DAILIES parsed to zero dict() entries')

  const dicts = entries.map((e) => {
    const d: Record<string, unknown> = {}
    for (const pair of splitTop(balanced(e, e.indexOf('('), '(', ')', 'ingest dict'))) {
      const eq = pair.indexOf('=')
      if (eq < 0) throw new Error(`ingest: dict member without a name: ${pair.slice(0, 40)}`)
      d[pair.slice(0, eq).trim()] = readValue(pair.slice(eq + 1), `ingest dict ${pair.slice(0, eq).trim()}`)
    }
    return d
  })

  const constants: Record<string, string> = {
    POSTER: pyConstant(py, 'POSTER'),
    DAILY_STRUCT: pyConstant(py, 'DAILY_STRUCT'),
    DAILY_DOC_DATE: pyConstant(py, 'DAILY_DOC_DATE'),
  }

  /* The INSERT the dailies loop builds. Anchored on `for d in DAILIES:` so the
     series insert further down cannot be picked up instead. */
  const loopAt = py.indexOf('for d in DAILIES:')
  if (loopAt < 0) throw new Error('ingest: the DAILIES apply loop was not found')
  const insAt = py.indexOf('insert into tournament_templates', loopAt)
  if (insAt < 0) throw new Error('ingest: no tournament_templates insert inside the DAILIES loop')
  const columns = splitTop(balanced(py, py.indexOf('(', insAt), '(', ')', 'ingest columns'))
  const selAt = py.indexOf('select', insAt)
  const fromAt = py.indexOf('from rooms', selAt)
  if (selAt < 0 || fromAt < 0) throw new Error('ingest: could not locate the select list')
  const selects = splitTop(py.slice(selAt + 'select'.length, fromAt))
  if (selects.length !== columns.length) {
    throw new Error(`ingest: ${columns.length} columns but ${selects.length} select expressions`)
  }

  /**
   * Resolve one select expression to a value.
   *
   * EVERY SHAPE IS LISTED AND ANYTHING ELSE THROWS. That is the point: a
   * template rewritten into a form this does not recognise must stop the test,
   * not silently drop a column from the comparison and keep reporting that the
   * two copies agree.
   */
  const resolve = (expr: string, d: Record<string, unknown>, col: string): unknown => {
    const s = expr.trim()
    let m = s.match(/^\{Q\(d\['([a-z_]+)'\]\)\}$/)
    if (m) return d[m[1]]
    m = s.match(/^\{d\['([a-z_]+)'\]\}$/)
    if (m) return d[m[1]]
    m = s.match(/^time\s+'\{d\['([a-z_]+)'\]\}'$/)
    if (m) return d[m[1]]
    m = s.match(/^\{str\(d\['([a-z_]+)'\]\)\.lower\(\)\}$/)
    if (m) return d[m[1]]
    /* The two null-aware helpers migration 014 added. They exist because a
       Python `None` has to become the SQL keyword `null` rather than the string
       "None", and they are matched here by name so the ten new columns stay
       individually visible to this comparison. */
    m = s.match(/^\{(?:NUM|WIN)\(d\['([a-z_]+)'\]\)\}$/)
    if (m) return d[m[1]]
    m = s.match(/^\{Q\(([A-Z_]+)\)\}$/)
    if (m) {
      if (!(m[1] in constants)) throw new Error(`ingest: ${col} cites unknown constant ${m[1]}`)
      return constants[m[1]]
    }
    m = s.match(/^date\s+'\{([A-Z_]+)\}'$/)
    if (m) {
      if (!(m[1] in constants)) throw new Error(`ingest: ${col} cites unknown constant ${m[1]}`)
      return constants[m[1]]
    }
    /* `{days}` is the local built immediately above from d['days']. Matched by
       name rather than evaluated, and the array it renders is asserted against
       the dict's own list by the test. */
    if (s === '{days}') return d.days
    return readValue(s, `ingest select ${col}`)
  }

  const rows = dicts.map((d) => {
    const row: Partial<Daily> = {}
    columns.forEach((col, i) => {
      if ((NOT_COMPARED as readonly string[]).includes(col)) return
      if (col === 'room_id') return
      const field = COLUMN_TO_FIELD[col]
      if (!field) throw new Error(`ingest: column ${col} has no place in the compared shape`)
      row[field] = resolve(selects[i], d, col) as never
    })
    return row as Daily
  })
  return { rows, columns }
}
