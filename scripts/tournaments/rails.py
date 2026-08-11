"""
THE GUARD RAILS, ONCE — the part of a tournament ingest that is the same for
every room.

═══ WHY THIS FILE EXISTS ═══

`wynn.py` grew every rail this pipeline has: preflight, precedence, content
hashing, one-log-row-per-sheet, an in-transaction gate, dry-run by default, and
a read-back over a fresh connection. All of it is correct and none of it is
about Wynn. Copying it per room would put three copies of the precedence check
in the tree, and the copy that rots would be the one nobody re-read.

So the rails live here and a room module supplies only what is genuinely
per-room:

    SOURCES   the live URLs, with the label each gets in `sources`
    ROOM      the slug every insert hangs off
    build()   fetch and parse into statements
    CHECKS    the counts this room's run must end with

⚠️ NOTHING HERE FETCHES. A room module fetches its own documents, because the
shape of "the document" differs per room — Wynn publishes two PDFs plus a
poster, The Orleans publishes one schedule and no longer links its structures —
and a rail that pretended otherwise would push that difference into a config
object nobody could read.

═══ WHAT A ROOM MODULE MUST NOT DO ═══

Write. `build()` returns SQL TEXT and the rails run it, in one transaction, with
the gate appended. A module that ran its own statements would be a second write
path, which is the failure `differ.mjs` opens by warning about.
"""
import datetime
import os
import subprocess
import tempfile

VEGAS_TZ = '-07'

Q = (lambda s: "'" + str(s).replace("'", "''") + "'")
N = (lambda s: int(str(s).replace(',', '')))
NUM = (lambda v: 'null' if v is None else str(v))

FETCHED = "timestamptz '{}'".format(
    datetime.datetime.now().astimezone().replace(microsecond=0).isoformat())


def psql_bin():
    if os.environ.get('PSQL'):
        return os.environ['PSQL']
    for c in ('psql', '/opt/homebrew/opt/postgresql@17/bin/psql'):
        try:
            subprocess.run([c, '--version'], check=True, capture_output=True)
            return c
        except Exception:
            pass
    raise SystemExit('psql not found. Install it, or set PSQL to its full path.')


def sql(db, q):
    r = subprocess.run([psql_bin(), db, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', q],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'SQL FAILED:\n{r.stderr.strip()[:900]}')
    return r.stdout.strip()


def run_sql_file(db, text):
    """One psql invocation = one session = one transaction. Via a file, because
       several hundred VALUES rows is past what belongs on a command line."""
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f:
        f.write(text)
        path = f.name
    try:
        r = subprocess.run([psql_bin(), db, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-f', path],
                           capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f'WRITE FAILED — nothing was committed:\n{r.stderr.strip()[:1200]}')
        return r.stdout
    finally:
        os.unlink(path)


def fetch(url, timeout=60):
    """⚠️ A CHEERFUL 200 IS NOT A DOCUMENT. Both Caesars and MGM answer every
    path with a bot interstitial — 200, HTML, a few kilobytes — so a fetch that
    only checks the status code would hand a parser an error page and the parser
    would report zero events from a document that is fine. Checked here, once,
    for every room."""
    import urllib.request
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    head = raw[:400].lower()
    if not raw.startswith(b'%PDF'):
        why = 'an HTML page' if b'<html' in head or b'<!doctype' in head else 'not a PDF'
        raise SystemExit(
            f'REFUSING TO PARSE {url}\n'
            f'  got {why} ({len(raw)} bytes). A room that answers 200 with an\n'
            '  interstitial is indistinguishable from one that answers with a\n'
            '  document unless somebody looks, so this looks.')
    return raw


def pages(raw):
    import io
    import re
    import pypdf
    return [re.sub(r'[ \t]+', ' ', p.extract_text() or '')
            for p in pypdf.PdfReader(io.BytesIO(raw)).pages]


def preflight(db, room_slug):
    """⚠️ THE ROOM MUST EXIST, asked before anything is written.

    Every insert hangs off `insert ... select ... from rooms where slug = ...`.
    If the room is absent that SELECT returns no rows, so the INSERT writes
    nothing, SUCCEEDS, and the run goes on to claim it wrote what it parsed.
    That is exactly how a fresh unseeded database produced 'sheets replaced 22 ·
    levels written 659' followed by a read-back of zero."""
    n = int(sql(db, f'select count(*) from rooms where slug = {Q(room_slug)}') or 0)
    if n != 1:
        raise SystemExit(
            f'refusing to run: rooms has {n} rows for slug {room_slug!r}.\n'
            '  Every write here hangs off that row, and without it the inserts\n'
            '  would silently write nothing while reporting success.')


def source_rows(sources):
    """`sources` registered data_type 'tournaments' — a WEB tier, so precedence
    ranks them below a floor visit and a person standing in the room can still
    correct anything this writes."""
    out = []
    for url, label in sources:
        out.append(f"""insert into sources (data_type, url, label, cadence_hours, status,
                             last_fetched_at, last_ok_at)
            values ('tournaments', {Q(url)}, {Q(label)}, 168, 'ok', now(), now())
            on conflict (url, data_type) do nothing;""")
    return out


def floor_verified(db, slug):
    """PRECEDENCE: a web-sourced document may not overwrite a template somebody
    stood in the room and verified."""
    n = sql(db, f'select count(*) from tournament_templates '
                f'where slug = {Q(slug)} and verified_at is not null')
    return bool(n) and int(n) > 0


def gate_sql(checks):
    """The room's assertions as a DO block, so a bad write cannot reach COMMIT.

    ⚠️ VERIFICATION THAT RUNS AFTER THE COMMIT DOES NOT PREVENT ANYTHING — it
    reports. The gate has to be inside the transaction, where a raise means a
    rollback. This is the rail that was missing when prod ended up in the
    half-finished state the standing rule forbids."""
    out = ['do $gate$', 'declare g bigint;', 'begin']
    for name, q, want in checks:
        out.append(f'  g := ({q.strip().rstrip(";")});')
        out.append(f"  if g <> {want} then raise exception "
                   f"'fidelity gate: {name} is %, expected {want}', g; end if;")
    out += ['end $gate$;']
    return '\n'.join(out)


def verify(db, checks):
    """The same assertions, re-read over a fresh connection after commit —
       against whatever we wrote to, not against the parse that produced it."""
    bad = 0
    for name, q, want in checks:
        got = int(sql(db, q) or 0)
        ok = got == want
        bad += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: {got}" + ('' if ok else f' (expected {want})'))
    return bad


def main(room):
    """Run one room module. `room` supplies NAME, ROOM, SOURCES, build(), CHECKS."""
    db = os.environ.get('DATABASE_URL')
    if not db:
        raise SystemExit('DATABASE_URL is not set. This writes to whatever it is given, '
                         'so it will not guess.')
    import re as _re
    dry = os.environ.get('INGEST_APPLY') != '1'
    host = _re.sub(r'//[^@]*@', '//', db).split('/')[2] if '//' in db else '?'
    print(f'\n══ {room.NAME} TOURNAMENT INGEST ══  target {host}  '
          f'{"APPLY" if not dry else "dry run"}')

    preflight(db, room.ROOM)

    print('  fetching the published documents…')
    stmts, stats = room.build(db)
    stmts = source_rows(room.SOURCES) + stmts
    checks = room.CHECKS

    if dry:
        print(f'  DRY RUN — nothing written. {len(stmts)} statements were built and')
        print(f'  the transaction would have ended with {len(checks)} assertions gating its COMMIT.')
        for k, v in stats.items():
            print(f'    would write: {k} {v}')
        return 0

    run_sql_file(db, 'begin;\n' + '\n'.join(stmts) + '\n' + gate_sql(checks) + '\ncommit;\n')

    for k, v in stats.items():
        print(f'  {k}: {v}')
    print('\n  verifying by reading the target back:')
    bad = verify(db, checks)
    if bad:
        # ⚠️ LOUD, because a non-zero exit is invisible through a pipe — the
        # first prod run was read through `| tail` and its exit code never
        # reached a shell. The banner survives what the status code does not.
        print('\n  ' + '=' * 60)
        print(f'  ✖ {bad} ASSERTION(S) FAILED AFTER COMMIT — the database is not what this run says')
        print('  ' + '=' * 60 + '\n')
        return 1
    print('\n  all assertions passed against the target.\n')
    return 0
