/**
 * ONE SPELLING OF THE SITE'S OWN ADDRESS.
 *
 * `metadataBase` in the layout, every `<loc>` in the sitemap and the `Sitemap:`
 * line in robots.txt must agree, and they are three files that get edited on
 * different days for different reasons. A sitemap advertising a host the
 * canonicals do not use is not a broken link — it is a second site, indexed
 * separately, splitting whatever authority the first one earned.
 *
 * The value is a constant rather than an env var on purpose: this is the
 * production domain, it is not per-environment, and a missing variable would
 * fail by publishing `undefined` into a crawler's index rather than by
 * refusing to build.
 */
export const SITE_URL = 'https://checkitdown.com'

/** The static routes, listed once. `/rooms/<slug>` is derived from the
 *  database — see `app/sitemap.ts` — and must never be added here.
 *  `/install` IS listed and IS meant to be found: it is the answer to somebody
 *  searching for how to get this on a phone, and a page nobody can find is the
 *  exact problem it was built to solve. Its `?platform=` spellings are
 *  `noindex, follow` at the page, the same ruling `/facts?compare=` carries. */
export const STATIC_PATHS = ['/', '/facts', '/tournaments', '/promos', '/install'] as const

/**
 * Paths no crawler should follow, and the reason is not secrecy.
 *
 * `/admin` already refuses strangers: RLS returns nothing without an admin row
 * behind the JWT. But it answers 200 while doing it, and a 200 is a URL — one
 * that gets indexed, ranks for the site's own name, and hands a searcher a page
 * that will never work for them. Refusing to serve DATA and refusing to be
 * LISTED are different problems with different fixes.
 *
 * `/auth` is the magic-link callback. A crawler fetching a one-time login URL
 * is a crawler consuming it.
 */
export const CRAWL_DISALLOW = ['/admin', '/auth'] as const
