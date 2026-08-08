import type { MetadataRoute } from 'next'

import { CRAWL_DISALLOW, SITE_URL } from '@/lib/site'

/**
 * `/robots.txt` 404'd from launch until 2026-08-07.
 *
 * A missing robots.txt is not "allow everything" by accident — it happens to
 * behave that way, which is why it survived. What it actually did was leave the
 * admin surface crawlable and leave the sitemap undiscoverable, and neither is
 * visible from inside the app.
 *
 * ALLOW-ALL IS THE DEFAULT AND STAYS THAT WAY. Every public page here is meant
 * to be found; the whole point of the room pages is that somebody searching
 * "orleans poker rake" arrives at a sourced answer.
 *
 * The two exclusions are in `lib/site.ts` beside the sitemap's copy of the same
 * list, so a path can never be disallowed here and advertised there.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...CRAWL_DISALLOW],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
