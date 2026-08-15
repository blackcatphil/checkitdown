import { redirect } from 'next/navigation'

/**
 * THE LEDGER IS RETIRED. It is the Rooms tab of the growth console now.
 *
 * ⚠️ THE ROUTE SURVIVES SO BOOKMARKS DO. The page is gone — it showed
 * ROOM · AREA · FILLED · VERIFIED, and every one of those is on
 * /admin/growth?tab=rooms, which additionally carries sessions, outbound, the
 * area filter, click-to-sort and a totals row. A strict superset, checked
 * column by column before this file was emptied.
 *
 * Converting it instead would have meant 115 `--cid-*` references restyled into
 * Modernist — a morning spent making a SECOND view of one dataset look like the
 * first, which is how two screens drift apart. One screen cannot disagree with
 * itself.
 *
 * ⚠️ TEMPORARY, NOT PERMANENT, AND THAT IS DELIBERATE. A 308 is the honest
 * status for a retired route, and browsers cache it hard enough that changing
 * our mind would mean chasing it out of every admin's browser by hand. This is
 * an internal route behind an allowlist with three readers; the cost of being
 * wrong outweighs the correctness of the code.
 */
export default function LedgerRedirect() {
  redirect('/admin/growth?tab=rooms')
}
