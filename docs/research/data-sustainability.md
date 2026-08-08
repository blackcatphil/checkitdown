# Data sustainability — what keeps each field true

*Tested 2026-08-07. Every claim below carries the method that produced it.*

The question this answers is not "where did we get this?" but **"what keeps it
right in six months?"** — because a fact with a source and no maintenance path
is a fact with an expiry date nobody has written down.

Three groups fall out of the sourcing work, and they need three different
answers.

---

## 1. Slow, person-verified fields — the partner's circulation maintains them

| Field | Coverage | Rate of change | Maintained by |
|---|---|---|---|
| Rake (cap, drop) | 33/78 games rake-verified | ~1–2×/yr | floor visit |
| Comps | 13/17 rooms | ~1–2×/yr | floor visit |
| Parking | 15/17 rooms | ~1–2×/yr | floor visit |
| Tableside food | 15/17 rooms | ~1–2×/yr | floor visit |
| Games spread | 78 rows, 6 game-verified | seasonal | floor visit |
| Table count | 16/17 rooms | ~1–2×/yr | floor visit |
| Hours | 17/17 rooms | rare | floor visit |

These change about as often as a room repaints. A partner who is already in
these rooms weekly re-confirms them as a side effect of being there, which is
why the floor sheet is a sustainable source rather than a one-off scrape: the
cost of the next refresh is nearly zero because somebody was going anyway.

**This is the group the product is currently good at**, and the six
game-verified rows from 2026-08-07 are the first evidence that the loop closes:
rows we declined to invent from prose in August were confirmed exactly as they
stood a week later.

---

## 2. Fast, unpublished fields — a feed problem, not a scraping problem

| Field | Rate of change | Published anywhere fetchable? |
|---|---|---|
| Daily tournament schedule | daily | **no** |
| Promotions / high hand | daily–weekly | **no** |
| Live waitlist | minutes | **no** (vendor apps only) |

Nothing in this group is solved by fetching harder. The schedules exist — they
are simply not on a page a machine may read, and the rooms that publish them
most reliably publish them to **social, email and relationships**.

> **@ARIAPoker posts daily tournament results and schedules on X while
> `aria.mgmresorts.com` returns `000`** — no response at all at the network
> level. The most locked-down room on the web is the most talkative one
> socially.

The implication is uncomfortable and worth stating plainly: **the volatile data
is a partnerships problem wearing an engineering costume.** Building a better
scraper cannot reach it.

### The designated-channel inventory

ARIA has **designated @ARIAPoker on X as the source** for its daily tournament
schedules (relayed 2026-08-07). This is the first entry in what should become a
standing inventory: *for each room, which channel has its operator told us to
read?* A designated channel is a stronger thing than a channel we happened to
find — it is a room taking responsibility for a number.

| Room | Designated channel | Designated by / when | Receipt |
|---|---|---|---|
| ARIA | @ARIAPoker on X | relayed 2026-08-07 | **owed** — who at ARIA, and when |

**The receipt is open on purpose.** "ARIA told us" is not yet a source in this
product's sense until we can say who said it and when, and the floor sheet now
carries the ask. Recording the gap beats letting a second-hand designation
harden into a citation — which is exactly how the Overpass non-constraint
survived four documents.

### X is not machine-readable, tested five ways

Before treating a designated social channel as an ingestion path, it was worth
testing whether a machine can read one at all. Five paths, all 2026-08-07, all
with a Chrome UA and redirects followed:

| Path | Result | Usable? |
|---|---|---|
| `x.com/ARIAPoker` | `200`, 190 KB — **zero** `tweetText` nodes; a JS shell | no |
| `cdn.syndication.twimg.com/timeline/profile` | `200` with a **zero-byte body** | no |
| `nitter.net/ARIAPoker` | `200` with a **zero-byte body** (same with and without `-L`) | no |
| `publish.twitter.com/oembed` | `200`, 432 B — a widget stub: one `<a>` and a `widgets.js` tag, no post text | no |
| `syndication.twitter.com/srv/timeline-profile` | `200`, 542 KB, **106 parseable posts** — but newest **2025-11-03**, and **zero from 2026** | **no — see the correction below** |

The fifth is the interesting one, and the trap. It parses. It returns a hundred
real posts with real text. Anything checking "did we get data?" would pass. But
**for this account** the newest item is nine months old and 2026 is empty, so
what came back is a cache wearing the shape of a live feed — the same failure
class as Vegas Advantage above: a `200` that is perfectly readable and no longer
true. It is also an unofficial, undocumented endpoint that can be removed without
notice, so even the stale data is not a foundation.

*(The original wording here — "it is a frozen cache" — stated a property of the
ENDPOINT from one account's reading. Scoped to the account it was measured on;
see the correction below.)*

*(Two results differ from the brief that prompted this test: nitter was expected
to `503` and oembed to `301`. Measured, nitter returns `200` with an empty body
and oembed `200` with a content-free stub. **Different status codes, identical
verdict** — recorded as measured rather than as briefed.)*

> **CORRECTED 2026-08-07 (same day).** The row above says the fifth path is
> "stale", and the conclusion drawn was that the ENDPOINT serves a frozen cache.
> The `@ARIAPoker` measurement was right; the generalisation was never tested.
> Re-run across eleven accounts in one minute, `@WSOP` returned posts from **that
> same day** and `@PokerNews` from the day before, while `@SPPokr` lagged fifteen
> months. **Freshness is per account and unsignalled.**
>
> Two consequences. It is *more* hazardous than a frozen cache, because it is
> sometimes correct and never says so. And this window **cannot establish
> whether an account is active** — a fifteen-month-old newest post is equally
> consistent with a dormant account and a cache nobody refreshed, so the
> @ARIAPoker daily-posting report above is not contradicted by its own stale
> entry. Full table: `dark-thirteen-channels.md` §1.

**Conclusion: designated social channels are human-readable or paid-API-readable
only. Nothing in Check It Down scrapes socials, and nothing should pretend to.**
A designated channel is a place a *person* looks — its value is that it tells us
where to send the person, not that it feeds a pipeline.

---

## 3. The fetchable web — a change DETECTOR, never a source of record

Four sources in the survey are fetchable at all, and `scripts/detect-changes.mjs`
uses them to raise proposals rather than to write facts. Two findings from this
pass push that further:

### Bravo is blocked — both waitlist vendors are now tested-unfetchable

```
curl -sL -A "<Chrome UA>" https://www.bravopokerlive.com/              -> 403, "Just a moment" (Cloudflare challenge)
curl -sL -A "<Chrome UA>" https://www.bravopokerlive.com/rooms        -> 404, served by Cloudflare
curl -sL -A "<Chrome UA>" https://www.bravopokerlive.com/rooms/las-vegas -> 404, served by Cloudflare
```

Tested 2026-08-07 with a browser User-Agent and redirects followed — the
distinction matters, because without `-L` the root returns `302` and looks
merely redirected rather than challenged. PokerAtlas was already measured at
`403`. **Both waitlist vendors are now tested, not assumed, and both are shut.**
Live table counts are unreachable by fetch from either.

### Vegas Advantage is a corroborating citation, not a change detector

```
vegasadvantage.com/.../wynn/  "dateModified":"2025-04-19T17:47:14-07:00"
vegasadvantage.com/.../aria/  "dateModified":"2025-04-19T15:59:11-07:00"
```

Both pages have been static for **~15.6 months**. They are the source behind a
large share of our seeded rake, and they are perfectly good for that — a
citation to a page that has not moved is still a citation. But a source that
never changes **cannot detect a change**, so pointing the detector at it and
watching for a diff would produce a permanent, comfortable silence that means
nothing. Use it to corroborate; do not use it to monitor.

> **NARROWED 2026-08-07 — the sample above is two pages.** `source-health.md`
> read `dateModified` from **all sixteen** Vegas Advantage pages we cite.
> Eleven are `2025-04-19` as measured here, but **Horseshoe moved 2026-05-28**,
> the open-rooms index `2026-04-12`, Caesars Palace and Green Valley Ranch
> `2025-12-21`, MGM Grand `2025-07-31`. *"Most of this site is static"* is
> supported; *"this site is static"* was not tested.
>
> The corroborate-don't-monitor conclusion survives — a site that moves on five
> pages of sixteen, unpredictably, is still not a change detector. But the
> reason is now *"it moves rarely and without pattern"* rather than *"it never
> moves"*, and those justify different things.
>
> **Same error shape as the X-cache correction above: two instances measured, a
> property of the set asserted.** Twice in two days.

### South Point still serves-but-empty — re-confirmed

The tournament survey recorded South Point's page as serving without tournament
content. Re-tested 2026-08-07: the page returns `200` with 105 KB, and contains
exactly **four** occurrences of "tournament" — all of them navigation links to
`bowl.com/tournaments/...` for the property's **bowling centre**. Not a poker
schedule in any of them. The original claim holds, and the reason is sharper
than "empty": a naive keyword scraper would have found four hits and reported
success.

---

## What follows from this

1. **Do not build a general scraper.** The fetchable set is four sources, two of
   them unusable, and the useful ones are static.
2. **The floor sheet is the source of record for slow fields**, and its
   sustainability comes from the partner's existing circulation rather than from
   our effort.
3. **The volatile fields need a feed, a relationship or an inbox** — the
   engineering question is what to do with a schedule once someone sends it, not
   how to go and take it.
4. **The detector's job is disagreement, not acquisition.** It exists to notice
   when a static page stops agreeing with the floor, which is a real event even
   though it is a rare one.
