/**
 * THE PARTNER LONG-FORM REVIEWS — a published Google DOC, not a sheet.
 *
 * The env var says CSV because every source slot in this job says CSV. This one
 * returns a 153KB styled HTML page. HANDLED BY WHAT IT IS, NOT BY ITS NAME:
 * the adapter is chosen per source, so the extension never decides anything.
 *
 * The login-wall detector still runs on it, and must: an HTML page arriving as
 * a cheerful 200 is exactly what that check was built to catch. The difference
 * is that here HTML is the expected shape, so the check is "is this the
 * document or is this a sign-in screen", asked by looking for the content.
 *
 * ═══ WHAT IS EXTRACTED, AND WHAT IS REFUSED ═══
 *
 * The document is flat — no headings, just paragraphs. It opens with a to-do
 * list ("Write all the long form reviews", then the sheet's column names), and
 * the actual reviews follow as: a room name on its own line, then several long
 * paragraphs.
 *
 * So a review heading is a paragraph that BOTH resolves to a room AND is
 * followed by real prose. That second condition is what separates the index at
 * the top — where "Venetian" is followed by "Caesars Palace" — from the review
 * further down, where "The Venetian" is followed by eighty-five words. Without
 * it every room in the index becomes an empty review.
 *
 * NO FACTS ARE INFERRED FROM THE PROSE. Not the stakes, not the rake, not the
 * amenities — even though all three are in there and readable by a person. A
 * differ that guesses at prose is worse than one that says it did not: "PLO
 * runs frequently, usually 1/2 with a $5 minimum limp" is a sentence about
 * typical conditions, not a row, and turning it into one would manufacture a
 * fact with a citation. Reported as read-but-not-parsed, every run.
 */

import { resolveRoom, type Room } from './floor-sheet.ts'

/** Paragraph text from the published HTML, in document order. */
export function paragraphs(html: string): string[] {
  const body = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
  const out: string[] = []
  for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    let t = m[1].replace(/<[^>]+>/g, '')
    t = t
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
      .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&mdash;/g, '—')
    t = t.replace(/\s+/g, ' ').trim()
    out.push(t)
  }
  return out
}

/** Google's publish chrome, which is not part of the document. */
const CHROME = /Published using Google Docs|Report abuse|Updated automatically every/

export type Review = {
  slug: string
  heading: string
  body: string
  words: number
  /** Currency figures in the prose — see the blocker below. */
  figures: string[]
}

export type ReviewsRead = {
  reviews: Review[]
  notes: { what: string; why: string }[]
}

/** A heading's body must be real prose, not the next index entry. */
const MIN_BODY_WORDS = 40

export function readReviews(html: string, rooms: readonly Room[]): ReviewsRead {
  const paras = paragraphs(html)
  const notes: ReviewsRead['notes'] = []

  /* Candidate headings: short, resolve to a room, and are followed by prose. */
  const heads: { i: number; slug: string; heading: string }[] = []
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    if (p === '' || CHROME.test(p)) continue
    if (p.split(' ').length > 5) continue
    const res = resolveRoom(p, rooms)
    if (!res.ok) continue
    const next = paras.slice(i + 1).find((x) => x !== '')
    if (next == null || next.split(' ').length < MIN_BODY_WORDS) continue
    heads.push({ i, slug: res.slug, heading: p })
  }

  const reviews: Review[] = []
  for (let n = 0; n < heads.length; n++) {
    const start = heads[n].i + 1
    const end = n + 1 < heads.length ? heads[n + 1].i : paras.length
    const body = paras.slice(start, end).filter((p) => p !== '' && !CHROME.test(p)).join('\n\n')
    if (body.trim() === '') continue
    reviews.push({
      slug: heads[n].slug,
      heading: heads[n].heading,
      body,
      words: body.split(/\s+/).length,
      figures: [...body.matchAll(/\$\s?\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]),
    })
  }

  notes.push({
    what: `${reviews.length} reviews read, ${paras.filter((p) => p !== '').length} paragraphs total`,
    why: 'no facts were inferred from the prose — stakes, rake and amenity claims are all in '
      + 'there and all readable by a person, and every one of them would be a manufactured '
      + 'row with a manufactured citation if this guessed',
  })

  return { reviews, notes }
}

/**
 * CAN THIS REVIEW BE STORED?
 *
 * `room_descriptions` carries `description_states_no_currency`, which since
 * migration 009 binds only `checkitdown` prose. That narrowing was a ruling,
 * not a workaround, and the reasoning belongs next to the check:
 *
 *   OUR descriptions are MAINTAINED FACTS. They have to stay true as the data
 *   moves, so they carry tokens that resolve from the same query the facts grid
 *   reads. A typed figure in one is a stale number waiting to happen.
 *
 *   A PARTNER REVIEW IS QUOTED MATERIAL. Tokenising it would edit an author —
 *   the sentence Chris wrote would stop being the sentence a reader sees, and
 *   would change under him as our data moved. Stripping the figures is worse:
 *   it deletes what he actually observed. So the figures stay verbatim and the
 *   visible written_at carries the staleness, which is the same answer this
 *   product already gives for "recently relocated".
 */
export function storageBlockers(r: Review, authorKind: 'partner' | 'checkitdown'): string[] {
  const out: string[] = []
  /* SCOPED TO OUR OWN PROSE since migration 009. A partner review is quoted
     material and keeps its figures verbatim — tokenising it would edit an
     author, and stripping the figures would remove what he observed. The
     staleness rides the visible written_at instead. Our descriptions are still
     refused, because they are maintained facts that must stay true as the data
     moves. */
  if (authorKind === 'checkitdown' && r.figures.length > 0) {
    out.push(
      `${r.figures.length} currency figures in the prose (${[...new Set(r.figures)].join(', ')}) `
      + '— a Check It Down description must interpolate tokens, not type figures',
    )
  }
  if (r.body.trim() === '') out.push('empty body')
  return out
}

/**
 * WHAT DATE THIS REVIEW CARRIES — first-seen, not authored.
 *
 * The document has no authored date and none is invented (migration 009). So
 * the stored date answers "how old is this take?" with the day we first saw
 * THIS text, which is an upper bound we can defend: it reads earlier than the
 * truth for a review written before we first fetched it, and never later, which
 * is the safe direction for a staleness signal.
 *
 * THE PART THAT MATTERS IS THAT IT DOES NOT MOVE ON AN UNCHANGED RE-READ. This
 * job runs every morning. If re-reading the same paragraph restamped it, every
 * review would permanently read "written today" and the date would be worthless
 * inside a week — the signal would still be there, still visible, and would
 * have quietly stopped meaning anything.
 */
export function firstSeenDate(
  held: { body: string; writtenAt: string } | null,
  incomingBody: string,
  today: string,
): { writtenAt: string; state: 'new' | 'unchanged' | 'rewritten' } {
  if (held == null) return { writtenAt: today, state: 'new' }
  /* BYTE-IDENTICAL, deliberately. A whitespace-insensitive compare would be
     kinder to the parser and would also hide a real edit — a rewritten
     paragraph that happens to normalise the same is exactly the case where the
     date must move. */
  if (held.body === incomingBody) {
    return { writtenAt: held.writtenAt || today, state: 'unchanged' }
  }
  return { writtenAt: today, state: 'rewritten' }
}
