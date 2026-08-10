/**
 * THE PARTNER FLOOR SHEET — its real shape.
 *
 * One row per room, one column per fact:
 *
 *     Room, Rake, Alt Games, Tableside Food, Parking, Atlas or Bravo, Phone
 *     Wynn, 5+0, plo, yes, Free, Atlas, (702) 770-7654
 *
 * This is NOT the room/field/value schema the differ was first written against.
 * That schema was invented before anyone had read the document, and the sheet
 * owes it nothing — the partner keeps this file for their own use and it will
 * keep its own shape. So the adapter bends, not the sheet.
 *
 * ═══ WHAT IS PARSED, AND WHAT IS DELIBERATELY NOT ═══
 *
 *   Rake        → rake_cap + jackpot_drop on EVERY cash game in the room
 *   Phone       → rooms.phone
 *   Parking     → room_amenities.freeself
 *   Tableside   → room_amenities.tableside
 *   Atlas/Bravo → room_waitlist.vendor
 *   Alt Games   → NOT PARSED. "plo, dbbp, ", "rare", "mixed games",
 *                 "$8/16 Omaha/8" — four different kinds of claim in one
 *                 column, and the honest ones are already rows in cash_games
 *                 with their own stakes and provenance. Inferring a game from
 *                 "rare" would invent a fact; inferring one from "$8/16
 *                 Omaha/8" would invent a citation for stakes this sheet does
 *                 not actually state. Reported, never guessed.
 *
 * ═══ THE ROOM-LEVEL RAKE APPLIES TO EVERY GAME, AND THAT IS A READING ═══
 *
 * The sheet states ONE rake per room; the database stores rake per stakes row.
 * Fanning one to many is an interpretation, so it is stated here rather than
 * buried: it is the same reading applied by hand on 2026-08-06/08 — Wynn's 5+0
 * sits on all five of its games, South Point's 5+3 on all six — and the dry run
 * is the check on it. If the fan-out were wrong, the first dry run would light
 * up with dozens of contradictions instead of the near-no-op expected.
 */

/** `5+3` is a $5 rake cap and a $3 jackpot drop. `5 + 3` is the same thing with
 *  the spaces a human leaves. Anything else is not a rake this can read. */
export function parseRake(raw: string): { cap: number; drop: number } | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/)
  if (!m) return null
  return { cap: Number(m[1]), drop: Number(m[2]) }
}

/**
 * `Free` → the room has free self-parking. `$25` → it does not.
 *
 * A PRICE IS A CONFIRMED ABSENCE, not a missing answer: the partner wrote a
 * number because they checked and it costs money. That distinction is the whole
 * content of the amenity model — "checked, has none" is a fact and "not
 * checked" is not — so it must survive the parse.
 */
export function parseParking(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (v === 'free') return true
  if (/^\$\s*\d/.test(v)) return false
  return null
}

/**
 * `yes` / `no`. NOTHING ELSE.
 *
 * South Point says "no but close", which is a real observation and not a
 * boolean — it means the room has no tableside service but food is a short walk
 * away. Coercing it to `false` would throw away the "but close" and record a
 * confident answer the sheet did not give; coercing it to `true` would be
 * worse. It is reported as unparsed, by name, every run, until someone decides
 * what the product should say.
 */
export function parseYesNo(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (v === 'yes') return true
  if (v === 'no') return false
  return null
}

/** The waitlist vendor enum, spelled the way the database spells it. */
export function parseVendor(raw: string): 'pokeratlas' | 'bravo' | null {
  const v = raw.trim().toLowerCase()
  if (v === 'atlas' || v === 'pokeratlas' || v === 'poker atlas') return 'pokeratlas'
  if (v === 'bravo') return 'bravo'
  return null
}

/** Digits only, so `(702) 770-7654` and `702-770-7654` compare equal. */
export const phoneDigits = (raw: string) => raw.replace(/\D/g, '')

/**
 * ═══ ROOM NAME → SLUG. THE PART THAT MUST NOT GUESS. ═══
 *
 * The sheet writes "Wynn"; we hold "Wynn/Encore" at `wynn-encore`. It writes
 * "Red Rock"; we hold "Red Rock Resort". It writes "Orleans"; we hold "The
 * Orleans". So exact matching alone resolves almost nothing, and the tempting
 * fix — take the best match — is the rule that once resolved "Venetian" to the
 * Sphere and "Orleans" to Louisiana. TOP-HIT-WINS IS BANNED HERE.
 *
 * The rule instead: normalise, then require the match to be UNIQUE. A name that
 * matches two rooms resolves to neither and is reported. A name that matches
 * none is reported. Silence is never an answer.
 *
 * Matching is tried in order of decreasing confidence, and each tier must be
 * unique on its own — a prefix hit does not get to break an exact-match tie.
 */
const norm = (s: string) =>
  s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '')

export type Room = { slug: string; name: string; property: string | null }

export type Resolution =
  | { ok: true; slug: string; how: 'exact' | 'prefix' }
  | { ok: false; why: string }

export function resolveRoom(sheetName: string, rooms: readonly Room[]): Resolution {
  const want = norm(sheetName)
  if (want === '') return { ok: false, why: 'blank room name' }

  const forms = (r: Room) => [norm(r.slug), norm(r.name), r.property ? norm(r.property) : '']

  const exact = rooms.filter((r) => forms(r).includes(want))
  if (exact.length === 1) return { ok: true, slug: exact[0].slug, how: 'exact' }
  if (exact.length > 1) {
    return { ok: false, why: `"${sheetName}" matches ${exact.length} rooms exactly (${exact.map((r) => r.slug).join(', ')}) — refusing to pick` }
  }

  /* A room whose recorded name STARTS WITH the sheet's shorter name.
     "wynn" -> "wynnencore", "redrock" -> "redrockresort". Deliberately
     one-directional: a sheet name longer than ours would be claiming something
     we do not hold, and that is a miss, not a match. */
  const prefix = rooms.filter((r) => forms(r).some((f) => f !== '' && f.startsWith(want)))
  if (prefix.length === 1) return { ok: true, slug: prefix[0].slug, how: 'prefix' }
  if (prefix.length > 1) {
    return { ok: false, why: `"${sheetName}" is ambiguous between ${prefix.map((r) => r.slug).join(', ')} — refusing to pick` }
  }

  return { ok: false, why: `"${sheetName}" matches no room on the roster` }
}

/** A fact the sheet states, before it is aimed at a database row. */
export type SheetFact =
  | { kind: 'rake'; slug: string; cap: number; drop: number }
  | { kind: 'phone'; slug: string; value: string }
  | { kind: 'amenity'; slug: string; amenity: 'freeself' | 'tableside'; available: boolean }
  | { kind: 'vendor'; slug: string; vendor: 'pokeratlas' | 'bravo' }

export type SheetRead = {
  facts: SheetFact[]
  unparsed: { room: string; column: string; raw: string; why: string }[]
}

const COLUMNS = ['room', 'rake', 'alt games', 'tableside food', 'parking', 'atlas or bravo', 'phone']

export function readFloorSheet(rows: string[][], rooms: readonly Room[]): SheetRead {
  const facts: SheetFact[] = []
  const unparsed: SheetRead['unparsed'] = []
  if (rows.length === 0) return { facts, unparsed }

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const missing = COLUMNS.filter((c) => !header.includes(c))
  if (missing.length > 0) {
    unparsed.push({
      room: '(header)', column: '-', raw: rows[0].join(','),
      why: `the sheet no longer has these columns: ${missing.join(', ')} — refusing to guess which moved where`,
    })
    return { facts, unparsed }
  }
  const at = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim()

  for (const r of rows.slice(1)) {
    const sheetName = at(r, 'room')
    /* The sheet carries a blank spacer row under the header. Not an error. */
    if (sheetName === '' && r.every((c) => c.trim() === '')) continue

    const res = resolveRoom(sheetName, rooms)
    if (!res.ok) {
      unparsed.push({ room: sheetName || '(blank)', column: 'Room', raw: r.join(','), why: res.why })
      continue
    }
    const slug = res.slug
    const note = (column: string, raw: string, why: string) =>
      unparsed.push({ room: sheetName, column, raw, why })

    const rakeRaw = at(r, 'rake')
    const rake = parseRake(rakeRaw)
    if (rake) facts.push({ kind: 'rake', slug, cap: rake.cap, drop: rake.drop })
    else if (rakeRaw !== '') note('Rake', rakeRaw, 'not a "cap+drop" rake')

    const phoneRaw = at(r, 'phone')
    if (phoneDigits(phoneRaw).length === 10) facts.push({ kind: 'phone', slug, value: phoneRaw })
    else if (phoneRaw !== '') note('Phone', phoneRaw, 'not a ten-digit phone number')

    const parkRaw = at(r, 'parking')
    const park = parseParking(parkRaw)
    if (park !== null) facts.push({ kind: 'amenity', slug, amenity: 'freeself', available: park })
    else if (parkRaw !== '') note('Parking', parkRaw, 'neither "Free" nor a price')

    const foodRaw = at(r, 'tableside food')
    const food = parseYesNo(foodRaw)
    if (food !== null) facts.push({ kind: 'amenity', slug, amenity: 'tableside', available: food })
    else if (foodRaw !== '') note('Tableside Food', foodRaw, 'not yes/no — a hedge is an observation, not a boolean')

    const vendRaw = at(r, 'atlas or bravo')
    const vend = parseVendor(vendRaw)
    if (vend) facts.push({ kind: 'vendor', slug, vendor: vend })
    else if (vendRaw !== '') note('Atlas or Bravo', vendRaw, 'not a waitlist vendor we know')

    const altRaw = at(r, 'alt games')
    if (altRaw !== '') {
      note('Alt Games', altRaw,
        'read but NOT parsed — this column mixes frequency ("rare"), variants ("plo") '
        + 'and full stakes ("$8/16 Omaha/8"); each would need a different claim and a '
        + 'guess here would invent a game or a citation')
    }
  }
  return { facts, unparsed }
}
