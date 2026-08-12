import { Pool } from 'pg'

/**
 * PER-ROOM EVENT COUNTS, LAST 7 DAYS.
 *
 * ⚠️ A ROOM READING 0 HAS BEEN MEASURED. The ledger held these columns back
 * until a producer existed; one does now. Thirteen of seventeen rooms will read
 * 0, and that is a FINDING — the producer ran and found nothing — not an
 * absence. `lib/growth-absence.ts` keeps the two apart.
 *
 * A ROLLING 7 DAYS, NOT A COMPLETE WEEK, and deliberately: this answers "is
 * anybody looking at this room right now", which does not need a week boundary.
 * The 7d delta DOES need one, and reads as pending until two weeks exist.
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/growth-rooms.ts is server-only')
}

const url = process.env.CID_EVENTS_DATABASE_URL

export type RoomCounts = { sessions: number; outbound: number }

export async function roomEventCounts(): Promise<Map<string, RoomCounts>> {
  const out = new Map<string, RoomCounts>()
  if (!url) return out
  const p = new Pool({
    connectionString: url, max: 1, statement_timeout: 4000, connectionTimeoutMillis: 4000,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
  })
  try {
    const { rows } = await p.query('select * from public.growth_room_counts()')
    for (const r of rows) {
      out.set(r.room_slug as string,
        { sessions: Number(r.sessions), outbound: Number(r.outbound) })
    }
  } catch (e) {
    console.error('[growth] room counts unreadable:', e instanceof Error ? e.message : String(e))
  } finally {
    await p.end().catch(() => {})
  }
  return out
}
