# Tournament schedule sources — survey, 2026-08-04

Every URL below was fetched from Phil's machine with a browser User-Agent.
Status is what the server actually returned, not what a search result claimed.

## THE FINDING THAT CHANGES THE INGESTION DESIGN

The brief says tournament PDFs are "replaced in place at the same URL, so a
fetch alone cannot tell you the schedule changed." **That is not how the two
publishers who actually ship PDFs work.**

- **Boyd (Orleans)** versions by query hash:
  `.../2026_jan_orleans_poker_daily-schedule.pdf?rev=c685253a...`
- **Wynn** versions by path timestamp:
  `.../image/upload/v1752010936/...Wynn_Signature_Series_Schedule.pdf`

Both mint a NEW URL when the document changes. Which produces the opposite
failure to the one we designed for:

> **A stale PDF URL returns 200 forever.**
> The January Orleans schedule still served 182,857 bytes on 4 August — a
> seven-month-old schedule, HTTP 200, no error. Two Wynn PDF versions both
> serve, 1.4 MB and 883 KB.

So polling a pinned PDF URL does not go stale loudly; it goes stale silently
and confidently. Content hashing does not help — the bytes never change,
because it is a different document at a different address.

**The source of truth is the LINKING PAGE, not the PDF.** Watch the page for a
changed href; the appearance of a new URL is the change signal. Hash the page's
extracted PDF links, not the PDF.

## Per room

| Room | Source | Status | Notes |
|---|---|---|---|
| Orleans | `static.boydgaming.net/.../poker-daily-tournament-schedule.pdf` | **200 · application/pdf · 17 KB** | Real daily schedule. Structures PDF also serves (5.1 MB). Best source in the survey. |
| Wynn/Encore | `wynnlasvegas.com/casino/poker` → `cdn.wynnresorts.com/...pdf` | **200 · PDF links in page** | Series schedule + structures as PDFs on a versioned CDN path. |
| Westgate | property poker page | 200 · HTML, times present | Times in markup (12:00pm, 10:00am); no PDF. Parseable. |
| South Point | `southpointcasino.com/casino/poker/` | 200 · HTML, no schedule | Page serves; no times, no PDF. Schedule not published here. |
| Caesars Palace | `caesars.com/caesars-palace/casino/poker` | 200 · HTML, no schedule | Page serves; nothing extractable. |
| Horseshoe | `caesars.com/horseshoe-las-vegas/casino` | 200 · HTML | Same. WSOP series is separate. |
| Venetian | `venetianlasvegas.com/resort/casino/poker.html` | 200 · HTML | **No daily recurring schedule** — DeepStack series only. Series pages carry schedules/structures. |
| Red Rock | `stationcasinos.com/play/poker/` | 200 · HTML, no schedule | Station publishes NO tournament schedules. |
| Green Valley Ranch | same | 200 · no schedule | Same. |
| Boulder Station | same | 200 · no schedule | Same. |
| Santa Fe Station | same | 200 · no schedule | Same. |
| Golden Nugget | `goldennugget.com/las-vegas/casino/poker/` | **403** | Blocked, as previously measured. |
| ARIA | `aria.mgmresorts.com/...` | **000** | No response at all — blocked at network level. |
| Bellagio / MGM Grand / Mandalay Bay | MGM properties | **000 expected** | Same block; four MGM rooms. |
| Skyline | `skylinerestaurantcasino.com` | **000** | No site at that host. Locals room, may have no web presence. |

## Dead ends worth recording

- **`stationcasinospoker.com`** — legacy domain, still lists Texas Station and
  Fiesta, both closed years ago. Do not use it; it will look like a source.
- **PokerAtlas returns 403** to automated fetches. So the competitor is not a
  fallback even setting aside whether we would want it to be.

## What this means for `sources`

1. Four of seventeen rooms have a publisher-served schedule we can fetch:
   **Orleans (PDF), Wynn (PDF), Westgate (HTML), Venetian (series HTML)**.
2. Thirteen rooms have nothing fetchable: four MGM + Golden Nugget (blocked),
   four Station rooms (nothing published), Skyline (no site), and three whose
   pages serve but carry no schedule (South Point, Caesars Palace, Horseshoe).
   (Corrected 2026-08-05 — the original said "nine" while its own list held
   ten, and omitted the three serve-but-empty pages.)
3. `sources` should store the **linking page** for PDF publishers, with the
   discovered PDF URL as a derived value — not the PDF URL as the source.
4. `content_hash` on the source row should hash **the extracted link set**, not
   the document. Hashing the PDF cannot detect a schedule that moved.
