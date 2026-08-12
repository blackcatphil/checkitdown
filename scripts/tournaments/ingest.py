#!/usr/bin/env python3
"""
ONE RUNNER, ONE SET OF GUARD RAILS, ONE MODULE PER ROOM.

    DATABASE_URL=... python3 scripts/tournaments/ingest.py orleans        # dry run (local)
    PROD_DATABASE_URL=... INGEST_APPLY=1 python3 scripts/tournaments/ingest.py orleans

The rails live in `rails.py` and are the same for every room: preflight that the
room row exists, register the sources as web-tier, refuse to overwrite anything
a floor visit verified, build one transaction, gate the COMMIT with the room's
own expected counts, and read them back over a fresh connection afterwards.

A room module supplies only what is genuinely per-room — NAME, ROOM, SOURCES,
`build(db)` and CHECKS. It fetches and parses; it never writes.

⚠️ DRY RUN IS THE DEFAULT and `INGEST_APPLY=1` is the only thing that changes
it. A tournament ingest that wrote by default would be one mistyped
DATABASE_URL away from rewriting production's schedule.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import rails  # noqa: E402

ROOMS = ('orleans', 'wynn', 'bellagio')


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ROOMS:
        raise SystemExit(f'usage: ingest.py <{"|".join(ROOMS)}>')
    name = sys.argv[1]
    # ⚠️ WYNN IS ON THE RAILS AS OF 2026-08-12. It used to raise here, because it
    # was the only ingest that had ever written to production and a silent
    # behaviour difference would have been expensive. The port was done against a
    # column-by-column diff of a production snapshot, run against an empty local
    # target, with zero differences across 26 templates / 61 instances / 659
    # levels — see the header of wynn.py.
    module = __import__(name)
    return rails.main(module)


if __name__ == '__main__':
    sys.exit(main())
