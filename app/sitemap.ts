import type { MetadataRoute } from 'next'

import { latestVerified, type Fact } from '@/lib/provenance'
import { CRAWL_DISALLOW, SITE_URL, STATIC_PATHS } from '@/lib/site'
import { supabase } from '@/lib/supabase'

/**
 * THE SITEMAP IS DERIVED, NEVER LISTED.
 *
 * Room detail is the long tail — seventeen pages that answer "what is the rake
 * at the Orleans" — and until 2026-08-07 nothing could find them: the site went
 * live with `metadataBase` set and no sitemap at all, so `/sitemap.xml` 404'd.
 *
 * A hardcoded list would work on the day it was written and then quietly stop
 * including the eighteenth room. That is the same class as the provenance
 * sentence that outlived its data, arriving in a file no human reads — and
 * nobody proof-reads a sitemap, so it would be wrong for months. So this asks
 * the database exactly the way `generateStaticParams` does, and `test:mixed`
 * asserts the two counts are equal.
 */

/* Matches every room page Next will actually build. `generateStaticParams` in
   app/rooms/[slug]/page.tsx applies NO status filter, and neither may this —
   see the note on closed rooms below. */
export const revalidate = 300

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  /* ONE STRING LITERAL. Splitting a select across `+` widens it to `string`,
     supabase-js infers GenericStringError and every field access below stops
     typechecking — documented in app/page.tsx, and it has caught me once. */
  const { data } = await supabase
    .from('rooms')
    .select(
      'slug,fetched_at,verified_at,cash_games(verified_at,rake_verified_at),room_amenities(verified_at),house_rules(verified_at),room_formats(verified_at)',
    )
    .order('slug')

  const rooms = (data ?? []) as unknown as Array<{
    slug: string
    fetched_at: string | null
    verified_at: string | null
    cash_games: Array<{ verified_at: string | null; rake_verified_at: string | null }>
    room_amenities: Array<{ verified_at: string | null }>
    house_rules: Array<{ verified_at: string | null }>
    room_formats: Array<{ verified_at: string | null }>
  }>

  /**
   * LASTMOD IS THE FRESHEST PROVENANCE STAMP, and `new Date()` is forbidden
   * here.
   *
   * A sitemap stamped with the build time tells a crawler that all
   * twenty-one pages changed the moment it was fetched. It is trivial to write,
   * it looks tidy, and it is a lie — repeated on every deploy until the crawler
   * stops believing any date the site emits. It is the number-copied-forward
   * class in a format no reviewer opens.
   *
   * The honest answer is already computed for the page: `latestVerified` over
   * the room's facts, the same helper the provenance block and the hero badge
   * use, so a date shown to a reader and a date given to a crawler cannot
   * disagree.
   *
   * FALLS BACK TO `fetched_at`, NOT UPWARDS. A room with nothing verified was
   * last touched when we read it off a page. Deliberately `??` and not
   * `max(...)`: a later fetch on a verified room would push the date forward,
   * and if the fetch changed nothing that is an overstatement. Understating
   * lastmod costs a slower re-crawl; overstating it is the failure being fixed.
   */
  const stampFor = (r: (typeof rooms)[number]): string | null => {
    const facts: Fact[] = [
      { kind: 'room', verifiedAt: r.verified_at, sourceUrl: null },
      ...r.cash_games.flatMap((g) => [
        { kind: 'game', verifiedAt: g.verified_at, sourceUrl: null },
        { kind: 'rake', verifiedAt: g.rake_verified_at, sourceUrl: null },
      ]),
      ...r.room_amenities.map((a) => ({ kind: 'amenity', verifiedAt: a.verified_at, sourceUrl: null })),
      ...r.house_rules.map((h) => ({ kind: 'rule', verifiedAt: h.verified_at, sourceUrl: null })),
      ...r.room_formats.map((f) => ({ kind: 'format', verifiedAt: f.verified_at, sourceUrl: null })),
    ]
    return latestVerified(facts) ?? r.fetched_at
  }

  /* CLOSED AND SEASONAL ROOMS ARE IN, and this is the one place the roster
     rules deliberately do NOT apply.
     `inRoster()` keeps closed rooms off the map and off every count, because
     the roster answers "where can you play tonight". A sitemap answers a
     different question: which URLs exist and are worth serving. A closed room's
     page is not a stub — it resolves to a DATED CLOSURE NOTICE naming when it
     shut and where to go instead, and the person who needs that most is
     somebody arriving from a search result months later. Omitting it turns a
     useful page into a 404 for exactly the reader it was built for.
     Seasonal is the same argument with a return date: WSOP·Paris is modelled
     and comes back when the series runs.
     So: no status filter, matching generateStaticParams. There is no closed or
     seasonal row in the database today, which is precisely why this needs a
     test rather than a comment — `test:mixed` closes a room and asserts it
     stays. */
  const roomUrls: MetadataRoute.Sitemap = rooms.map((r) => ({
    url: `${SITE_URL}/rooms/${r.slug}`,
    lastModified: stampFor(r) ?? undefined,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  /* The aggregate pages change when any room's data changes, so they carry the
     freshest stamp on the site — again a real date, not the build time. */
  const freshest = rooms
    .map(stampFor)
    .filter((v): v is string => v != null)
    .sort()
    .at(-1)

  const staticUrls: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    lastModified: freshest,
    changeFrequency: 'daily',
    priority: path === '/' ? 1 : 0.7,
  }))

  const all = [...staticUrls, ...roomUrls]

  /* NO QUERY STRINGS, AND NOTHING A CRAWLER IS TOLD TO SKIP.
     `/facts?compare=a,b` is already `noindex,follow` — a personalised view of a
     public page — and listing one in a sitemap contradicts the page's own
     header. Two instructions, disagreeing, and the crawler picks. The admin and
     auth paths are excluded here as well as in robots.txt: a sitemap is a
     REQUEST to index, so listing a disallowed path is not merely redundant, it
     is the opposite instruction.
     Both are structurally impossible above rather than filtered — this asserts
     it anyway, because "impossible by construction" is what the last four
     regressions were before somebody changed the construction. */
  return all.filter((entry) => {
    const path = entry.url.slice(SITE_URL.length)
    if (path.includes('?')) return false
    return !CRAWL_DISALLOW.some((d) => path === d || path.startsWith(`${d}/`))
  })
}
