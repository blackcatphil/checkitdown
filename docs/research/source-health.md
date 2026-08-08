# Source health — all 44 rows, fetched and classified

*Measured 2026-08-07 by `scripts/source-health.mjs`. Read-only: nothing written
to `sources`, no `pending_changes`, no `last_fetched_at` touched. Every URL was
read from the database, never retyped.*

The detector watches four sources. There are forty-four, and the other forty had
never been checked as a set.

**Headline: NOTHING HAS ROTTED. The concentration is the real finding.**
Not one cited figure rests on a source that has decayed. Fourteen rest on a
source **we cannot read from here**, which is a different statement and was
originally written as the first one — see the correction below. Meanwhile 38 of
44 rows sit on a single third-party host, and **every rake figure in the product
rests on one permission-walled spreadsheet**.

---

## THE METHOD, AND WHAT THESE LABELS ARE STATEMENTS ABOUT

Every bucket below describes **what our client got from this machine.** None of
them describes the web.

`SHELL`, `BLOCKED` and `DEAD` are readings of one HTTP client, on one network,
from one datacenter, at one moment. A page that refuses us may serve a person in
Las Vegas perfectly. The document already said "zero BLOCKED and zero DEAD is a
finding about us, not about the web" as an aside; it is promoted here to the
method, because the first version of this document buried that qualifier and
then wrote "the source is gone" about a page that was serving fine.

The one bucket that IS a statement about the world is `ALIVE`: a fact we cite was
found in bytes we actually read. Positive evidence travels; absence does not.

## The verdict, in the order it matters

| | Cited figures | Share |
|---|---|---|
| **Machine-confirmed** — a fact we cite was found in bytes we read | **86** | 52% |
| **Unverifiable by machine — partner floor sheet.** Permission-walled by design; strongest provenance we have | **64** | 39% |
| **Unverifiable by machine — the client is blocked.** Bot mitigation answers us, not the site | **14** | 9% |
| **Decayed** | **0** | 0% |
| **Total figures on room detail and /facts** | **164** | |

**The honest answer to "how healthy are the two surfaces" is: NOT ONE of the 164
figures rests on a source known to have decayed.** 86 are confirmed still
serving by direct reading. The other 78 are **unverifiable from this machine** —
64 because the source is a private document, 14 because a WAF answers our
client. Unverifiable is not unverified: it is a limit on the instrument.

Both halves of that matter. Reporting "52% healthy" would understate it by
treating the unreadable as the rotten. Reporting "100% healthy" would overstate
it by treating the unreadable as the checked. **86 of 164 is what we have
actually checked, and 0 of 164 is what we have found wrong.**

### By fact type

| Fact | Machine-confirmed | Floor sheet | Client blocked | Decayed |
|---|---|---|---|---|
| Rake | 0 | **33** | 0 | 0 |
| Stakes | 62 | 3 | **13** | 0 |
| Room (tables, hours, comps) | 16 | 0 | 1 | 0 |
| Amenities | 8 | 28 | 0 | 0 |

**Not one rake figure depends on a fetchable page.** The column Just the Facts
ranks on rests entirely on the partner's floor visits. That is the strongest
sentence in this document and it was not what I expected to find.

---

## Buckets

| Bucket | Rows | URLs | What it means |
|---|---|---|---|
| ALIVE | 40 | 17 | a cited fact was found in bytes we read |
| PRIVATE | 2 | 2 | permission-walled by design; not fetched |
| ~~SHELL~~ → **CHALLENGED** | 2 | 1 | **200 from a bot-mitigation edge, not from the site** |
| MOVED / BLOCKED / DEAD | **0** | 0 | |

`SHELL` is struck rather than renamed silently: the label shipped in this
document's first version and the reason it was wrong is the most useful thing
here. A thin 200 has at least three causes — a client-rendered page, a broken
site, and a WAF challenge — and only the last one was actually happening.

44 rows sit on **20 distinct URLs** — the same page is often registered under
`rooms`, `cash` and `amenities`. Each URL was fetched **once**; hitting one page
three times is three chances to get three answers.

### Zero BLOCKED and zero DEAD — the same caveat, now the method above

`sources` contains four hosts and none of them is MGM, Golden Nugget or Skyline.
We only ever cited pages that could be fetched, so the walls documented
elsewhere do not appear here. **Skyline's dead host
(`skylinerestaurantcasino.com`, `000`) is NOT in `sources`** — it exists only in
`tournament-sources.md`. Nothing in the product cites it, which is why the error
survived unnoticed: it was never load-bearing.

---

## CORRECTION — The Orleans is not a casualty. We are being blocked.

The first version of this document said:

> *"One source has genuinely rotted, taking 14 cited figures with it."*
> *"It is a client-rendered shell: the response is fine, the source is gone."*

**Both sentences are wrong, and the second is wrong twice over.** Phil loaded the
same URL in a browser on 2026-08-07 and got the full page: 35 tables, hours,
games and two live tournament PDF links. Nothing has rotted.

### What the 212 bytes actually are

Re-fetched with the URL read from the database, never retyped:

```
orleans.boydgaming.com/play/poker-room   200 · 212 bytes · 0 bytes of text

<html><head>
<META NAME="robots" CONTENT="noindex,nofollow">
<script src="/_Incapsula_Resource?SWJIYLWA=...">
</script><body></body></html>

set-cookie: visid_incap_2855187=...  x-iinfo: 48-247894249-0 0NNN RT(...)
```

That is an **Imperva/Incapsula bot-mitigation challenge**, served with HTTP 200.
Not a client-rendered shell — a WAF politely declining to talk to us. The
`noindex,nofollow` is the giveaway: the page is telling crawlers not to keep it,
which a real room page would never do.

**So the classification was wrong at the root.** `SHELL` was a guess about *why*
the bytes were thin, and it guessed "the site is broken" when the bytes said "you
are not welcome". It also mis-stated the size: 83 bytes of text was an earlier
fetch; today it is 212 bytes and **zero** text.

### It is not browser-versus-curl either

The obvious repair — "use a real browser" — was tested and does not hold. A
headless Chromium **from this machine** gets `text=0` on the same URL, and both
comparison hosts throw outright:

| From this machine | curl | headless Chromium |
|---|---|---|
| `orleans.boydgaming.com/play/poker-room` | 200, 0 text | 200, **0 text** |
| `aria.mgmresorts.com/...` | `000` | `ERR_HTTP2_PROTOCOL_ERROR` |
| `goldennugget.com/...` | `403` | navigation refused |
| `westgateresorts.com/...` | 200, 9.6 KB | 200, 6.0 KB text |

The variable is **not just** where the request comes from — and the row above
disproves the neat version of that claim. Headless Chromium ran **on the same
machine, over the same connection, as Phil's Chrome**, which loads all three of
these pages in full. Same origin, different client, opposite outcome. So origin
reputation is one signal and **client fingerprint is another**: a headless
browser is detectable — `navigator.webdriver`, the headless user-agent, the
missing plugin and font surface — and Imperva scores both.

**The operational consequence is stronger than either single explanation, and it
is the sentence to keep:** *no automated client we can run reaches these pages.*
Not curl from a datacenter, and not headless Chromium from a normal connection.
"Drive a real browser instead" is not a workaround — it is the same wall with a
longer approach. Only a person's own logged-in browser session gets through, and
that is a human process, not a pipeline.

**But the documents behind these pages are a different story, and it is the
useful one.** MGM Grand's tournament PDFs sit on `assets.contentstack.io` and
were fetched with plain `curl` from a datacenter on 2026-08-07: HTTP 200, and
each carries a `Last-Modified` header — the only machine-readable freshness
signal found anywhere in this survey. **The page is walled; the CDN is open.**
Where a room publishes its facts as a linked document rather than as page text,
that document may well be reachable even when the page around it is not — and
that is where any automation effort belongs.

### What it costs: nothing, and less than that

It backs **13 stakes rows and 1 room row**. Those figures are **unverifiable by
machine**, not wrong. And The Orleans' 13 rake figures cite the **floor sheet**,
not this page, so the rake column never depended on it.

### Was this a one-off? No — and there was no second instance to sweep

The bucket table shows `SHELL: 2 rows, 1 URL`. The two rows are the *same* URL
registered under two `data_type`s, so **there was never a second SHELL instance
to re-examine** — one URL was the whole bucket. Said explicitly because "we
checked the other one" would be a claim about a row that does not exist.

The `ALIVE` rows are not at risk of the same error in reverse: each was
classified by **finding a cited fact in bytes we read**, which a challenge page
cannot satisfy. Positive evidence is what makes that bucket safe.

---

## The Westgate rake sentence — a real change, and it costs nothing

`westgateresorts.com/.../casino/poker/` returns `200` with 9,643 bytes and the
`7 tables` fact it is cited for is present, so it classifies **ALIVE**. But the
detector's rake sentence is **gone**:

```
detector rake sentence: ABSENT   (searched: /rakes? (N%)? up to $X/)
```

**No figure depends on it.** All four Westgate cash games have
`rake_source_url = NULL` — we never recorded a rake for Westgate at all, because
the page's own numbers were never captured.

So this is a **detector** problem, not a citation problem: `detect-changes.mjs`
targets this URL and will report it failing forever, training a reader to ignore
the status column. Recorded, not fixed.

---

## Vegas Advantage is not frozen — a correction to my own claim

`data-sustainability.md` records Vegas Advantage as *"static since 2025-04-19,
~15.6 months"*. **That was measured on two pages — Wynn and ARIA — and
generalised to the site.** Across all sixteen VA pages we cite:

| dateModified | Pages |
|---|---|
| 2026-05-28 | Horseshoe |
| 2026-04-12 | the open-rooms index |
| 2025-12-21 | Caesars Palace, Green Valley Ranch |
| 2025-07-31 | MGM Grand |
| 2025-04-19 | **the other eleven** |

The 2025-04-19 finding was real and covers most of the site. The generalisation
was not tested.

**This is the second time in two days I have made this exact error** — the first
was declaring X's syndication endpoint "a frozen cache" from one account's
reading, when `@WSOP` came back current to the hour. The shape is identical:
*measure two instances of a set, state a property of the set.* Both corrections
are now in the documents that carried the claim.

It also matters practically: **Horseshoe's page moved 10 weeks ago**, so a
detector pointed at Vegas Advantage would not be pointed at a dead thing after
all — for a handful of pages.

---

## Age of the page behind each figure

A `200` from a page nobody has touched since April 2025 is a finding even though
it is not a failure.

| Age of the page behind the figure | Figures |
|---|---|
| No `dateModified` published | 79 |
| **Over 12 months** | **69** |
| 6–12 months | 11 |
| Under 6 months | 5 |

The 79 with no `dateModified` are almost all floor-sheet and Boyd/Westgate
citations, where the question does not arise the same way — the floor sheet
carries its own `verified_at`, which is better than a page's self-reported
timestamp.

**69 figures rest on a page over a year old.** They are correct as far as this
check can tell — the facts are still on the pages — but "still there" and "still
true" are different, and only a floor visit separates them.

---

## Per-URL detail

All 20 distinct URLs. Bytes are **text after stripping script and style**, not
response size — the distinction that separates Orleans' 83 from its ~900-byte
response.

| Status | Text | dateModified | Room | URL |
|---|---|---|---|---|
| ALIVE | 13,354 | 2026-04-12 | Skyline | `vegasadvantage.com/open-las-vegas-poker-rooms/` |
| ALIVE | 6,652 | 2025-04-19 | ARIA | `…/aria/` |
| ALIVE | 6,896 | 2025-04-19 | Bellagio | `…/bellagio/` |
| ALIVE | 6,918 | 2025-04-19 | Boulder Station | `…/boulder-station/` |
| ALIVE | 6,622 | 2025-12-21 | Caesars Palace | `…/caesars-palace/` |
| ALIVE | 6,347 | 2025-04-19 | Golden Nugget | `…/golden-nugget/` |
| ALIVE | 6,806 | 2025-12-21 | Green Valley Ranch | `…/green-valley-ranch/` |
| ALIVE | 9,945 | 2026-05-28 | Horseshoe | `…/horseshoe/` |
| ALIVE | 6,591 | 2025-04-19 | Mandalay Bay | `…/mandalay-bay/` |
| ALIVE | 6,731 | 2025-07-31 | MGM Grand | `…/mgm-grand/` |
| ALIVE | 6,825 | 2025-04-19 | Red Rock | `…/red-rock/` |
| ALIVE | 6,870 | 2025-04-19 | Santa Fe Station | `…/santa-fe-station/` |
| ALIVE | 6,959 | 2025-04-19 | South Point | `…/south-point/` |
| ALIVE | 7,262 | 2025-04-19 | Venetian | `…/venetian/` |
| ALIVE | 6,855 | 2025-04-19 | Westgate | `…/westgate/` |
| ALIVE | 7,084 | 2025-04-19 | Wynn/Encore | `…/wynn/` |
| ALIVE | 9,643 | — | Westgate | `westgateresorts.com/…/casino/poker/` |
| PRIVATE | — | — | Wynn/Encore | `docs.google.com/document/…` (Long Form Reviews) |
| PRIVATE | — | — | 15 rooms | `docs.google.com/spreadsheets/…` (floor sheet) |
| **CHALLENGED** | **0** (212 B total) | — | The Orleans | `orleans.boydgaming.com/play/poker-room` — Incapsula challenge, not the site |

---

## Concentration — the risk this measurement actually exposes

| Host | Rows | Share |
|---|---|---|
| `vegasadvantage.com` | 38 | 86% |
| `docs.google.com` (floor sheet + doc) | 2 | 5% |
| `orleans.boydgaming.com` | 2 | 5% |
| `westgateresorts.com` | 2 | 5% |

**86% of the citation table is one third party**, and it is a third party that
already publishes some pages it has not touched in sixteen months. Nothing is
broken today. But the failure mode is not gradual: if Vegas Advantage restructures
its URLs or goes behind a wall, **86 of 164 figures lose the only machine check
they have in one afternoon** — and every one of them still renders, exactly as
the Orleans figures do now.

That last clause is the point, and The Orleans is the worked example: a source
can stop being readable by us without anything on the page changing and without
anything on our pages changing either. The exposure is not that figures would
become wrong; it is that we would lose the ability to tell.

The floor sheet is the counterweight and it is working — it already carries
every rake figure. The direction of travel is right; the exposure is real.

---

## What was almost recorded wrong

**Two false MOVED verdicts, caught before publication.** The first version
probed for our own stakes label verbatim — `$1/3` — and marked the Wynn and
Westgate pages MOVED. Both pages carry the stakes; they write them **without the
dollar sign**:

> *"…the buy-in range is $200 to $600 for 1/3, $400 to $1,500 for 2/5 and $1,000
> to $3000 at 5/10"* — Wynn
>
> *"The main game at the Westgate poker room is 1/2 no-limit hold'em… A 2/4 or
> 4/8 fixed limit hold'em game may pop up"* — Westgate

**MOVED is the most expensive verdict in this table** — it accuses a live source
of having dropped a fact, and would have sent someone to re-cite two pages that
never changed. The probe now matches the numeric core with an optional `$`.

And the fix was checked in the other direction too, because a looser probe
invites false ALIVEs: every match was read **in context** before the numbers
here were trusted. `1/2` on the Westgate page is *"1/2 no-limit Texas hold'em"*,
and `2/4` on the index page is *"The only game is 2/4 fixed-limit Texas
Hold'em"* — the Skyline entry. This is the same discipline that caught "15 poker
mentions" on Skyline being video poker, a CSS class and an image filename.

**The ROOM column was also blank on every row at first.** It read
`sources.room_id`, which is NULL on all 44 rows — a report that looked complete
and identified nothing. It now derives the room from who cites the URL.

---

## Findings recorded, not fixed

Fixing a citation is a data change and needs a ruling per finding.

| # | Finding | Suggested ruling |
|---|---|---|
| 1 | The Orleans URL returns an Incapsula challenge to this client; 14 citations are unverifiable by machine | **Do not re-cite and do not mark it `failing`.** The page serves fine to a person; the citation is good. What is needed is a way to record "we cannot check this from here" that is not the same state as "this source broke" |
| 1b | `source-health.mjs` still classifies that challenge page as `SHELL` | Teach `classify()` to detect a mitigation edge (`_Incapsula_Resource`, `x-iinfo`, `cf-mitigated`, `noindex,nofollow` on a near-empty body) and report `CHALLENGED`. **Left unfixed on purpose** — this pass was scoped docs-only, and a re-run today would reproduce the wrong label. Fix before the numbers are quoted again |
| 2 | `westgateresorts.com` has dropped the rake sentence the detector looks for | Detector-only. Either drop the target or teach it that "no rake sentence" is a state, not a failure |
| 3 | 86% of citations sit on one host | Not a bug. A standing risk worth a named owner |
| 4 | 69 figures rest on pages over a year old | Feeds the floor-visit priority list — oldest citation first |
| 5 | `sources.room_id` is NULL on all 44 rows | Populating it would make this report cheaper; it is also the column a future channel inventory would need |
| 6 | Vegas Advantage's static claim was over-generalised | **Corrected in `data-sustainability.md` and the README as part of this pass** — the only thing here that was fixed, because a wrong tested-claim is worse than none |

---

## How to re-run it

```
node scripts/source-health.mjs           # table + buckets
node scripts/source-health.mjs --json    # machine-readable
```

It needs no credentials and writes nothing. Re-running it after a floor visit,
or after any change to `sources`, costs 20 fetches.
