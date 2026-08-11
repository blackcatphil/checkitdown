/**
 * REBUY AND ADD-ON TERMS, READ BACK OUT OF THE ROOM'S OWN SENTENCE.
 *
 * ═══ THIS IS A CROSS-CHECK, NOT A SOURCE ═══
 *
 * The terms are DECLARED — in `supabase/seed.sql` and in
 * `scripts/tournaments/wynn.py` — by a person who read the poster, for the same
 * reason the dailies themselves are declared rather than parsed: the poster is
 * a marketing image whose useful content is prose conditions, and re-deriving
 * "unlimited $200 rebuys at 15,000 chips or less" from it every morning risks a
 * silent mistranscription of a rebuy rule. That is a falsehood about money.
 *
 * So what this file does is the opposite direction. `reentry_note` holds the
 * room's sentence verbatim; the columns hold the same terms structured; and
 * this parses the sentence so a test can assert the two agree. Neither is
 * derived from the other at write time — they are two hand transcriptions of
 * one poster, gated as a pair, exactly like the dailies themselves.
 *
 * ═══ IT IS TOTAL, OR IT REFUSES ═══
 *
 * A parser that extracts what it recognises and shrugs at the rest is the
 * dangerous shape here. Given "unlimited $200 rebuys at 15,000 chips or less,
 * and one $100 add-on", a partial parser that only knew about add-ons would
 * return `{ addon: 100 }` and a test comparing it to the declaration would pass
 * while the entire rebuy clause went unchecked.
 *
 * So every clause of the sentence must be ACCOUNTED FOR. What is left after the
 * recognised clauses are removed has to be inert — a connective, a
 * parenthetical time, a full stop. Anything with a figure or an unrecognised
 * verb in it is a refusal, by name, with the leftover text quoted.
 */

export type Terms = {
  rebuyAmount: number | null
  rebuyChips: number | null
  rebuyMax: number | null
  rebuyUnlimited: boolean
  rebuyMaxStack: number | null
  rebuyWindow: OfferWindow | null
  addonAmount: number | null
  addonChips: number | null
  addonMax: number | null
  addonWindow: OfferWindow | null
  /** What the note says about re-entry, when it says anything. */
  reentryAllowed: boolean | null
  /** Registration/offer close, as a level number, when the note states one. */
  closesAtLevel: number | null
}

export type OfferWindow = 'first_break' | 'through_late_reg'

export type ParseResult =
  | { ok: true; terms: Terms }
  | { ok: false; why: string }

const EMPTY: Terms = {
  rebuyAmount: null, rebuyChips: null, rebuyMax: null, rebuyUnlimited: false,
  rebuyMaxStack: null, rebuyWindow: null,
  addonAmount: null, addonChips: null, addonMax: null, addonWindow: null,
  reentryAllowed: null, closesAtLevel: null,
}

const money = (s: string): number => Number(s.replace(/[$,]/g, ''))
const count = (s: string): number => {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 }
  const w = words[s.toLowerCase()]
  return w ?? Number(s.replace(/,/g, ''))
}

/**
 * Each clause: what it matches, what it contributes, and — because the whole
 * design rests on it — the text it consumes so the leftover check can see what
 * nobody claimed.
 */
export function parseTerms(note: string | null | undefined): ParseResult {
  if (note == null || note.trim() === '') return { ok: false, why: 'no note to read' }
  const terms: Terms = { ...EMPTY }
  let rest = ` ${note} `

  /* Order matters only where one pattern is a prefix of another; the rebuy
     clause is tried before the bare "re-entry" clause because "Re-entry is NOT
     allowed. Unlimited $200 rebuys…" contains both. */

  const eat = (re: RegExp, take: (m: RegExpMatchArray) => void): boolean => {
    const m = rest.match(re)
    if (!m) return false
    take(m)
    rest = rest.replace(m[0], ' ')
    return true
  }

  /* "Re-entry allowed", "Re-entry is NOT allowed", "Re-entry and one $100
     add-on" — the last of which is an allowance, not a prohibition. */
  eat(/Re-entry is NOT allowed\.?/i, () => { terms.reentryAllowed = false })
  eat(/Re-entry (?=allowed|and\b)/i, () => { terms.reentryAllowed = true })
  eat(/\ballowed\b/i, () => { /* the verb of the clause above */ })

  /* "Unlimited $200 rebuys at 15,000 chips or less" — and the threshold clause
     is optional, so it is eaten separately rather than made part of one
     pattern that would fail whole if a room omitted it. */
  eat(/\b(unlimited|\d+)\s+\$([\d,]+(?:\.\d+)?)\s+rebuys?\b/i, (m) => {
    terms.rebuyAmount = money(m[2])
    if (/unlimited/i.test(m[1])) terms.rebuyUnlimited = true
    else terms.rebuyMax = count(m[1])
  })
  eat(/\bat\s+([\d,]+)\s+chips?\s+or\s+less\b/i, (m) => {
    terms.rebuyMaxStack = count(m[1])
  })
  /* "$50 add-on for 15,000 chips" — Caesars' shape, where the figure IS the
     chips received. Eaten before the bare add-on clause below. */
  eat(/\b(?:(one|two|three|\d+)\s+)?\$([\d,]+(?:\.\d+)?)\s+add-on\s+for\s+([\d,]+)\s+chips?\b/i, (m) => {
    terms.addonAmount = money(m[2])
    terms.addonChips = count(m[3])
    terms.addonMax = m[1] ? count(m[1]) : null
  })
  eat(/\b(?:(one|two|three|\d+)\s+)?\$([\d,]+(?:\.\d+)?)\s+add-on\b/i, (m) => {
    terms.addonAmount = money(m[2])
    terms.addonMax = m[1] ? count(m[1]) : null
  })

  /* WHEN. "until the start of level 9" closes the offers at registration close;
     "at the first break" is Caesars' window. Both set the window on whichever
     offers were actually found — a window with no offer to attach to is
     meaningless and is reported as such below. */
  let window: OfferWindow | null = null
  eat(/\buntil the start of level\s+(\d+)\b/i, (m) => {
    window = 'through_late_reg'
    terms.closesAtLevel = Number(m[1])
  })
  eat(/\b(?:takeable\s+)?(?:only\s+)?at the first break\b/i, () => { window = 'first_break' })
  /* "registration closes at the start of level seven" — a level stated in
     words, which is how Caesars writes it. */
  eat(/\bregistration closes at the start of level\s+([a-z]+|\d+)\b/i, (m) => {
    const words: Record<string, number> = {
      four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    }
    terms.closesAtLevel = words[m[1].toLowerCase()] ?? Number(m[1])
  })

  if (window != null) {
    if (terms.rebuyAmount != null) terms.rebuyWindow = window
    if (terms.addonAmount != null) terms.addonWindow = window
    /* A WINDOW MAY BELONG TO THE RE-ENTRY RATHER THAN TO AN OFFER. "Re-entry
       allowed until the start of level 9" is three of the four Wynn dailies and
       names no rebuy at all — the level is registration's close, which is
       already captured as `closesAtLevel`. The first version refused those,
       which would have made the cross-check unusable on most of the population
       it was written for. The refusal is kept for the case it was actually
       aimed at: a window attached to nothing whatsoever. */
    if (terms.rebuyAmount == null && terms.addonAmount == null && terms.reentryAllowed == null) {
      return { ok: false, why: `the note states a window ("${window}") but names nothing it applies to` }
    }
  }

  /* An approximate clock time restates the level in wall-clock terms and adds
     nothing storable — the level is the fact, the time is its gloss. */
  eat(/\(approximately[^)]*\)/i, () => {})

  /**
   * ⚠️ THE LEFTOVER CHECK. Everything above can succeed while a whole clause
   * about money goes unread, so what remains has to be inert. Connectives and
   * punctuation are inert; a dollar sign, a digit or an unconsumed verb is not.
   */
  const leftover = rest
    .replace(/\b(and|or|the|a|an|of|until|at|is|in|to|with|only|for|per|start|level|registration|closes|player|players|entry|re-entry)\b/gi, ' ')
    .replace(/[.,;:()—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (leftover !== '') {
    return { ok: false, why: `unread text left in the note: "${leftover}"` }
  }

  return { ok: true, terms }
}

/**
 * THE COMPONENTS A SURFACE MAY SHOW, and the absence of the one it may not.
 *
 * Both /tournaments and the room page ask the same question — "what does this
 * event cost?" — and the answer is a list, never a number. This returns the
 * list, plus whether the entry BOUNDS the cost, which is the only thing a
 * ranking is entitled to say.
 *
 * `bounded` is a fact, not a model: it is false exactly when the room has
 * published an offer whose count it did not limit. It exists so both surfaces
 * decide the same way rather than each growing its own idea of when a total is
 * defensible.
 */
export type CostShape = {
  /** The entry, which is what total_buy_in holds. */
  entry: number | null
  /** Published extras, in the order a reader meets them. Never summed. */
  extras: Array<{ label: string; amount: number; qualifier: string | null }>
  /** False when a published offer has no ceiling — an open-ended cost. */
  bounded: boolean
}

export function costShape(t: {
  total_buy_in?: number | string | null
  rebuy_amount?: number | string | null
  rebuy_max?: number | null
  rebuy_unlimited?: boolean | null
  addon_amount?: number | string | null
  addon_max?: number | null
}): CostShape {
  const num = (v: number | string | null | undefined): number | null =>
    (v == null || v === '' ? null : Number(v))
  const extras: CostShape['extras'] = []
  const rebuy = num(t.rebuy_amount)
  const addon = num(t.addon_amount)

  if (rebuy != null) {
    extras.push({
      label: 'REBUY',
      amount: rebuy,
      qualifier: t.rebuy_unlimited ? 'unlimited'
        : t.rebuy_max != null ? `up to ${t.rebuy_max}`
          : null,
    })
  }
  if (addon != null) {
    extras.push({
      label: 'ADD-ON',
      amount: addon,
      qualifier: t.addon_max != null ? (t.addon_max === 1 ? 'one' : `up to ${t.addon_max}`) : null,
    })
  }
  /* UNBOUNDED IS EXACTLY "an offer exists and nothing caps it". An unstated
     count is not unlimited — but it is not a ceiling either, so it does not
     bound the cost and must not be treated as though it did. */
  const openRebuy = rebuy != null && (t.rebuy_unlimited === true || t.rebuy_max == null)
  const openAddon = addon != null && t.addon_max == null
  return { entry: num(t.total_buy_in), extras, bounded: !openRebuy && !openAddon }
}
