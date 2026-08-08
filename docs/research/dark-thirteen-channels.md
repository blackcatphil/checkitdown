# The dark thirteen — channel inventory

*Research only. Nothing written to the database, no `sources` rows, no schema
change, no detector change. Tested 2026-08-07.*

Thirteen of seventeen rooms publish nothing a machine may read. The tournaments
page cannot be honest for them until we know where their volatile data actually
lives. This is that inventory — and, more usefully, an honest account of how
little of it can be established without paying.

---

## How to read the evidence column

Every row carries how it was established. Half this project's expensive mistakes
were untested claims that read identically to tested ones.

| Label | Meaning |
|---|---|
| **OBSERVED** | I fetched it and read the bytes. Repeatable from this machine. |
| **SECONDHAND** | A search engine's view of a platform I cannot read directly. The handle may be right; the *behaviour* is not established. |
| **INFERRED** | Reasoned from something else. No direct evidence. |
| **NOT CHECKED** | Nobody has looked. |

**Two things are never collapsed here:** *"an account exists"* and *"an account
publishes the thing we need"*. Nor are *"the account is dormant"* and *"the only
window I have onto it is stale"*.

---

## 1. The correction that has to come first

The brief carries a claim I wrote on 2026-08-07: that
`syndication.twitter.com/srv/timeline-profile` serves *"a cache whose newest post
is 2025-11-03"*, and therefore fails as a live feed.

**That was true of @ARIAPoker and I generalised it to the endpoint. It is not a
property of the endpoint.** Eleven accounts, same request, same minute:

| Account | Newest post in the cache | Lag |
|---|---|---|
| `@WSOP` | **2026-08-07** | **today** |
| `@PokerNews` | 2026-08-06 | 1 day |
| `@stationcasinos` | 2026-07-01 | ~5 weeks |
| `@MGMGrandPoker` | 2026-06-02 | ~2 months |
| `@southpointlv` | 2025-09-06 | ~11 months |
| `@ARIAPoker` | 2025-11-03 | ~9 months |
| `@BellagioPoker` | 2025-07-31 | ~12 months |
| `@GNLVpoker` | 2025-06-01 | ~14 months |
| `@SPPokr` | 2025-05-02 | ~15 months |
| `@CaesarsPalace` | — no data at all | — |
| `@HorseshoeVegas` | — no data at all | — |

The endpoint can be **current to the hour**. Whether it is depends on the
account, and nothing in the response says which you are holding. *(OBSERVED.)*

This makes it **more** dangerous than "it is frozen", not less. A frozen source
is safely useless. This one is sometimes right, and the failure is silent.

**And it means the cache cannot establish activity.** A fifteen-month-old newest
post is equally consistent with a dormant account and with a busy account this
cache has not refreshed. Phil's report that @ARIAPoker posts daily schedules is
**not contradicted** by its 2025-11-03 entry — both can be true. Nothing below
claims a room's account is inactive; the honest finding is *"not established"*.

### The control that makes `posts=0` meaningless

`syndication.twitter.com/.../cid_control_no_such_acct_9931` — a handle that
cannot exist — returns **`200` with zero posts**, identical to a real handle
whose cache is empty. So in the tables below:

- **`posts > 0`** is positive evidence the handle exists.
- **`posts = 0`** proves *nothing*. It is not evidence of absence.

---

## 2. Per-room inventory

Property-level and poker-room accounts are listed separately throughout. They
behave differently and only one of them posts schedules.

### MGM — ARIA, Bellagio, MGM Grand, Mandalay Bay

Every MGM host returns **`000`** — no response at the network level, not a 403.
Five hosts tested (`aria.`, `bellagio.`, `mgmgrand.`, `mandalaybay.`
`.mgmresorts.com`, plus `www.mgmresorts.com`). *(OBSERVED.)*

| Room | Poker account | Exists? | Cache newest | Property account |
|---|---|---|---|---|
| ARIA | `@ARIAPoker` · `@ariapokerlv` (IG) | **yes** — 106 posts (OBSERVED) | 2025-11-03 | `@AriaLV` (SECONDHAND) |
| Bellagio | `@BellagioPoker` | **yes** — 109 posts (OBSERVED) | 2025-07-31 | — |
| MGM Grand | `@MGMGrandPoker` | **yes** — 121 posts (OBSERVED) | 2026-06-02 | `@MGMResortsIntl` (SECONDHAND) |
| Mandalay Bay | none found | **not established** — `posts=0`, indistinguishable from the control | — | — |

- **What they post:** NOT ESTABLISHED. The only window is the stale cache. Phil
  reports @ARIAPoker carries daily schedules and results *(relayed, receipt
  owed — see `data-sustainability.md`)*.
- **Email list:** NOT CHECKED — the signup would live on an `000` host.
- **Poker phone:** NOT ESTABLISHED. Unreachable site; Vegas Advantage publishes
  none *(OBSERVED — its four MGM pages `200` and carry no `702` number)*.

**Three of four MGM poker rooms run their own poker-specific X account.** That
is the strongest finding in this document: the most locked-down properties on the
web are the ones with dedicated poker channels.

### Golden Nugget

| Field | Finding | Evidence |
|---|---|---|
| Poker account | `@GNLVpoker` — 102 posts, "24/7 Cash Games and Daily Tournaments" | OBSERVED (existence) / SECONDHAND (bio) |
| Facebook | `facebook.com/goldennuggetlvpoker` | SECONDHAND |
| Cache newest | 2025-06-01 (~14 months) | OBSERVED |
| What it posts | NOT ESTABLISHED | — |
| Website | `403` — Cloudflare, as previously measured | OBSERVED |
| Email list | NOT CHECKED — signup would be behind the 403 | — |
| Poker phone | NOT ESTABLISHED | — |

The bio claims daily tournaments. **A bio is a marketing claim, not a schedule** —
it says the room runs them, not that the account publishes them.

### Station — Red Rock, Green Valley Ranch, Boulder Station, Santa Fe Station

All four share one corporate web presence and, apparently, one poker channel.

| Field | Finding | Evidence |
|---|---|---|
| Poker account | `@STN_Poker` | SECONDHAND — `posts=0`, so **existence not confirmed** |
| Property accounts | `@stationcasinos` (X/FB/IG), `@redrockcasino` | OBSERVED — linked in the site footer |
| `@stationcasinos` cache | 2026-07-01 | OBSERVED |
| Per-property poker account | none found | SECONDHAND |
| Website | `200`, fully readable | OBSERVED |
| Email list | `stationcasinos.com/email-signup/` → **404**. A list may exist elsewhere. | OBSERVED |
| Poker phone | **none published** on `/play/poker/`, `/red-rock/casino/poker/` or `/green-valley-ranch/casino/poker/` | OBSERVED |

The sharpest finding here is in Station's own FAQ schema, which we can read:

> *"For upcoming tournaments and event details, visit the specific property poker
> room page or contact the poker room directly."*

**The site tells you to phone the room, and publishes no number to phone.**
*(OBSERVED.)* Four rooms, one instruction, zero means of following it.

### Skyline — and a source URL we hold is wrong

| Field | Finding | Evidence |
|---|---|---|
| Website | **`skylinehotelandcasino.com` is LIVE** — `200`. Homepage 232 KB with **one** `poker` hit; `/casino/` 136 KB with 15 | OBSERVED |
| What the poker hits ARE | **Mostly not a poker room.** 3 are *video poker* (a machine), 2 are markup — a CSS class `poker-room` and an image `Poker_room.webp` — and the rest are that image's srcset URLs. Zero `hold'em`, zero `tournament`, zero `live poker`. The only poker PROSE on the page reads *"blackjack, slot machines, video poker, and more"* | OBSERVED (chat-Claude, on review) |
| The host we hold | `skylinerestaurantcasino.com` → `000` | OBSERVED |
| Poker account | none | OBSERVED — the site links only property socials |
| Property accounts | `@SkylineCasino` (X), `Skyline.Hotel.Casino` (FB/IG) | OBSERVED — read from the site's own footer |
| **Phone** | **702-565-9116** — the only phone number found for any of the thirteen | OBSERVED |
| Tournament schedule | not on the page | OBSERVED |
| Vegas Advantage | **404** — Skyline is not on their open-rooms list | OBSERVED |

**`docs/research/tournament-sources.md` records Skyline as "`000` — no site at
that host. Locals room, may have no web presence."** The host was wrong. The site
exists and publishes a phone number. This is the Westgate-typo class again: a URL
we hold failing, reported as a fact about the world.

**But the site does NOT confirm a live poker room** — see the row above. A
keyword count of `poker` on a casino page is the SOUTH POINT `bowl.com` CASE
exactly: 15 hits, of which the readable ones are *video poker*. The room is on
our roster on other evidence; this page is not that evidence, and the phone
number is what makes Skyline worth a call — not the page's poker hits. Also
tested: the site runs The Events Calendar (`tribe_events`) and its iCal feed
(`?post_type=tribe_events&ical=1`) returns **empty** — a machine-readable
endpoint with nothing in it *(OBSERVED, chat-Claude)*.

*This is a correction to a document, not to data — no `sources` row cites the
dead host today. Recorded here; not fixed, because fixing it is a data change and
this task is research only.*

### South Point

| Field | Finding | Evidence |
|---|---|---|
| Poker account | `@SPPokr` — 101 posts | OBSERVED (existence) |
| Facebook | `facebook.com/southpointpoker` | SECONDHAND |
| Cache newest | 2025-05-02 (~15 months) | OBSERVED |
| Property account | `@southpointlv` (X/FB/IG) — cache 2025-09-06 | OBSERVED |
| Website | `200`, fully readable | OBSERVED |
| **Email list** | **`southpointcasino.com/email-list` → `200`** (existence only; not signed up) | OBSERVED |
| Poker phone | **not published.** Hotel `702-796-7111`, reservations, spa — no poker-labelled number on either poker page | OBSERVED |

The only room of the thirteen with a **confirmed, reachable email signup**.

### Caesars Palace and Horseshoe

| Field | Caesars Palace | Horseshoe | Evidence |
|---|---|---|---|
| Poker account | none found | none found | SECONDHAND |
| Property account | `@CaesarsPalace` (X/FB/IG) | `@HorseshoeVegas` (X/FB/IG) | OBSERVED — site footers |
| Property cache | **no data at all** | **no data at all** | OBSERVED |
| Website | `200` | `200` | OBSERVED |
| Poker phone | none on the poker page — no `702`, no toll-free | not checked separately | OBSERVED / NOT CHECKED |
| Email list | Caesars Rewards (`caesars.com/myrewards` → `200`) — a loyalty programme, not a poker list | INFERRED that it is not poker-specific | OBSERVED (URL) |

Horseshoe hosts the WSOP each summer, and **`@WSOP` is the one poker channel in
this whole survey with a current cache (2026-08-07)** *(OBSERVED)*. That is a
series account, not a room account: it will carry WSOP, not Horseshoe's daily
board the other ten months.

### Facebook and Instagram are walled too

`facebook.com/goldennuggetlvpoker` and `facebook.com/southpointpoker` both return
**`400`** to a browser-UA fetch *(OBSERVED)*. Every Facebook and Instagram handle
in this document is therefore **SECONDHAND** — named by a search engine or by a
link in a property's own footer, never read.

---

## 3. Verdict

The question this decides: is the X purchase worth $40/month, or worth zero?

### Worth paying to read — 4 rooms

**ARIA, Bellagio, MGM Grand, Golden Nugget.** All four have a confirmed
poker-specific account, all four sit behind a website that cannot be fetched at
all (`000` or `403`), and for all four the account is the *only* candidate
channel anyone has identified.

**But the value is unproven, and the uncertainty is the point.** What none of
these accounts has been shown to do is *publish a daily schedule*. The single
piece of evidence pointing that way is Phil's relayed report about @ARIAPoker,
which has no receipt yet. **Paying $40/month buys the ability to find out** —
which is a real thing to buy when four otherwise-unreachable rooms are on the
other side, and a bad thing to buy if nobody looks within the first month.

**Recommended: buy one month, and spend it answering one question** — do these
four accounts post the daily board, or only marketing? That is a
fifteen-minute-a-day human task, and it converts the largest unknown in this
document into a fact. Do not renew on hope.

### Email-only — 1 room

**South Point.** Confirmed signup at `/email-list`, no reachable schedule, a
poker account whose cache is 15 months old. The list is the cheapest channel in
this document: free, and it arrives.

### Relationship-only — 5 rooms

**Red Rock, Green Valley Ranch, Boulder Station, Santa Fe Station** — the site
instructs you to call the poker room and publishes no number, so the channel is
a person who has one. **Mandalay Bay** — no poker account established, no
reachable site.

### Phone-first — 1 room

**Skyline.** The one room with a published poker-adjacent phone number
(702-565-9116) and a readable site nobody had found. Cheapest win in the
document: one call, no subscription.

### Nothing at all — 2 rooms

**Caesars Palace, Horseshoe.** No poker account, property accounts with no
retrievable history, no published poker phone. Horseshoe is partly covered by
`@WSOP` for six weeks a year and uncovered the rest.

### The bottom line

| Verdict | Rooms |
|---|---|
| Worth paying to read (unproven, time-boxed) | 4 |
| Email-only | 1 |
| Relationship-only | 5 |
| Phone-first | 1 |
| Nothing at all | 2 |

**Seven of thirteen have no channel that any amount of money reaches.** X
access, at best, addresses four — and only if those accounts turn out to post
what we need. **The volatile data for the majority of the dark thirteen is a
partnerships problem, and no subscription changes that.**

---

## 4. Design note — if channels ever become `sources` rows

**Requirement, stated. Not implemented, and nothing here should be built yet.**

`scripts/detect-changes.mjs` builds its target list *from* `sources`. A channel
row would therefore enter the detector's rotation automatically, and both failure
modes are silent:

1. **A walled URL** (X, Facebook, PokerAtlas, Bravo) marks the source `failing`
   forever — noise that trains a reader to ignore the status column.
2. **A frozen cache parses cleanly.** §1 shows the syndication endpoint returning
   `200` with a hundred well-formed posts whose newest is fifteen months old. It
   would sail through `classify()` — status `200`, comfortably over the
   2,000-byte floor, content present — and be recorded `ok` with a fresh
   `last_ok_at`. **The detector would report a healthy source that has told it
   nothing since 2025.**

So:

- Channels need **their own `data_type`** — `'channel'`, distinct from `'cash'`,
  `'floor'` and `'tournament'`.
- **The detector must filter on it**, not merely skip unknown types. Its current
  `TARGETS` list is hand-written, which is what protects it today; that
  protection disappears the moment anyone derives targets from a query.
- Any future channel reader must assert **recency**, not retrieval. "Did we get
  data?" is the check §1 defeats. The check that works is *"is the newest item
  newer than the last one we saw?"*
- A channel row must never be a **receipt**. Nothing in this document is
  verification, and a `sources` row is the shape a citation takes.

---

## 5. What is still owed

| Owed | Why it is not here |
|---|---|
| Do the four poker accounts post daily schedules? | Unanswerable without authenticated access — the whole subject of the verdict |
| Is `@STN_Poker` real? | `posts=0`, indistinguishable from the control; needs a human to open it |
| Receipt for the @ARIAPoker designation | Who at ARIA said so, and when — on the floor sheet |
| Horseshoe's poker phone | NOT CHECKED — only Caesars Palace's poker page was grepped |
| Mandalay Bay poker channel | Nothing found; absence not established |
| Station and MGM email lists | Signup pages sit behind `404` and `000` respectively |
| `tournament-sources.md`'s Skyline entry | Wrong host recorded; correcting it is a data change, out of scope here |
