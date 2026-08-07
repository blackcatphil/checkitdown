/**
 * WHAT A RECEIPT LOOKS LIKE WHEN THE SOURCE IS NOT PUBLIC.
 *
 * Every fact on this site carries a source, and until now every source was a
 * page a reader could open. The partner floor data is the first that is not: it
 * is a Google Sheet only the team can see, so rendering it the way we render a
 * casino's rake page hands a reader a link that dead-ends at a permission wall.
 * A receipt that cannot be checked is worse than no link at all — it looks like
 * evidence and behaves like a locked door.
 *
 * So a private source states the thing that IS checkable: that a person stood in
 * the room, and when. No href.
 *
 * THE DISTINCTION COMES FROM THE DATA. `sources.data_type = 'floor'` marks it,
 * not a hardcoded URL or a `docs.google.com` match — the next private source
 * will be on a different host, and a URL test would silently start leaking
 * again the day it arrives.
 */

/** The set of source URLs that must never be rendered as a link. */
export type PrivateSources = ReadonlySet<string>

export function isPrivate(url: string | null | undefined, priv: PrivateSources): boolean {
  return url != null && priv.has(url)
}

/** `2026-08-06` — the date is the part of a floor visit a reader can act on. */
export function onDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10)
}

/**
 * The words for a source that cannot be linked. Deliberately says who did what
 * rather than naming the document: "our partner's spreadsheet" is not a
 * verifiable claim to a reader, and the checkable fact is the floor visit.
 */
export function inPersonReceipt(iso: string | null | undefined): string {
  const on = onDate(iso)
  return on ? `Confirmed in person on ${on}.` : 'Confirmed in person.'
}

/** A public source shows its host, which is what a reader recognises. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
