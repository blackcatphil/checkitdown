#!/usr/bin/env python3
"""
ONE RUNNER, ONE SET OF GUARD RAILS, ONE MODULE PER ROOM.

    DATABASE_URL=... python3 scripts/tournaments/ingest.py orleans        # dry run
    DATABASE_URL=... INGEST_APPLY=1 python3 scripts/tournaments/ingest.py orleans

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

ROOMS = ('orleans', 'wynn')


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ROOMS:
        raise SystemExit(f'usage: ingest.py <{"|".join(ROOMS)}>')
    name = sys.argv[1]
    if name == 'wynn':
        # ⚠️ NOT YET PORTED, AND SAYING SO RATHER THAN PRETENDING. `wynn.py` is
        # the original and still carries its own copy of the rails — it is also
        # the only ingest that has ever written to production, so moving it is a
        # change with real risk and belongs in its own round with its own
        # verification. Until then it runs from its own entry point.
        raise SystemExit(
            'wynn has not been ported to the shared rails yet.\n'
            '  Run it directly:  npm run ingest:tournaments\n'
            '  Porting it is a separate change — it is the only ingest that has\n'
            '  written to prod, and a silent behaviour difference there would be\n'
            '  expensive.')
    module = __import__(name)
    return rails.main(module)


if __name__ == '__main__':
    sys.exit(main())
