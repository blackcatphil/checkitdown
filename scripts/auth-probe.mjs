#!/usr/bin/env node
/**
 * THE ADMIN GATE, END TO END. Nobody had ever held a session on this project.
 *
 * Every privilege assertion until now was made with `pg_temp.runs_as` — a
 * `set local role` plus a hand-built `request.jwt.claims`. That proves the SQL
 * is right and proves nothing about whether a person can actually sign in and
 * be recognised: it never mints a token, never sets a cookie, never asks
 * PostgREST anything. The PKCE bug lived in exactly that gap — Supabase's logs
 * said `action=login` while the app said "code verifier not found in storage",
 * and no test in this repo could see the difference.
 *
 * So this drives the REAL flow:
 *
 *   1. Mint a magic link through the Admin API, which returns the same
 *      `hashed_token` the email template would carry.
 *   2. Hand that to the app's own /auth/callback and keep the Set-Cookie
 *      headers it writes.
 *   3. Ask the database who we are, over HTTP, with those cookies' token —
 *      never by inspecting the schema.
 *
 * Step 1 is why this needs no dashboard change to run: `generate_link` hands
 * back the token hash directly, so the flow is testable before the email
 * template is edited, and stays testable afterwards.
 *
 * IT CLEANS UP AFTER ITSELF. Both test users are deleted and the admin row is
 * removed, asserted at the end — an allowlist row left behind is a real
 * privilege granted by a test run.
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'

const PSQL = resolvePsql()
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const APP = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

/* Local-stack keys, read from the CLI rather than pasted — a key in a repo is
   a key in a repo even when it is the well-known demo one. */
function keys() {
  if (process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY }
  }
  /* CI installs the CLI as a bare binary (supabase/setup-cli, which is why
     test:rls runs `supabase test db`); locally it only exists through npx.
     Try both rather than picking one and being wrong in the other place —
     the same class as the psql path. */
  let raw = null
  for (const [cmd, args] of [
    ['supabase', ['status', '-o', 'json']],
    ['npx', ['supabase', 'status', '-o', 'json']],
  ]) {
    try { raw = execFileSync(cmd, args, { encoding: 'utf8' }); break } catch { /* try the next */ }
  }
  if (raw == null) {
    throw new Error(
      'could not read the local stack keys.\n'
      + '   Tried `supabase status -o json` and `npx supabase status -o json`.\n'
      + '   Start the stack with `supabase start`, or set SUPABASE_ANON_KEY and\n'
      + '   SUPABASE_SERVICE_ROLE_KEY.',
    )
  }
  const j = JSON.parse(raw)
  return { anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY }
}

let failed = 0
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

const ADMIN_EMAIL = 'cid-probe-admin@example.test'
const PLAIN_EMAIL = 'cid-probe-stranger@example.test'

const { anon, service } = keys()
const svc = { apikey: service, Authorization: `Bearer ${service}` }

/** Create (or reuse) a confirmed user, and return its id. */
async function makeUser(email) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }),
  })
  if (res.ok) return (await res.json()).id
  /* Already there from a previous run — find it rather than failing. */
  const list = await fetch(`${API}/auth/v1/admin/users?page=1&per_page=200`, { headers: svc })
  const found = (await list.json()).users?.find((u) => u.email === email)
  if (!found) throw new Error(`could not create or find ${email}: ${await res.text()}`)
  return found.id
}

async function deleteUser(id) {
  await fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc })
}

/** The token hash an email template would carry as {{ .TokenHash }}. */
async function mintTokenHash(email) {
  const res = await fetch(`${API}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  if (!res.ok) throw new Error(`generate_link failed: ${res.status} ${await res.text()}`)
  const j = await res.json()
  return j.hashed_token ?? j.properties?.hashed_token
}

/**
 * Walk the app's own callback with a token hash, exactly as a click would.
 * Returns the redirect Location and the cookies the route set.
 */
async function signIn(tokenHash, type = 'magiclink', next = '/admin/review') {
  const res = await fetch(
    `${APP}/auth/callback?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`
      + `&next=${encodeURIComponent(next)}`,
    { redirect: 'manual' },
  )
  const setCookie = res.headers.getSetCookie?.() ?? []
  const jar = setCookie.map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ')
  return { status: res.status, location: res.headers.get('location'), jar, setCookie }
}

/** The access token the browser would now be carrying, read out of the jar. */
function accessTokenFrom(jar) {
  /* @supabase/ssr chunks the session cookie; the pieces are named -0, -1, …
     and concatenate in order. Reassembled here rather than assumed to be one
     cookie, because the chunking is exactly the kind of detail that makes a
     hand-rolled check pass on a short session and fail on a real one. */
  const parts = jar.split('; ').filter((c) => /^sb-.*-auth-token/.test(c))
  if (parts.length === 0) return null
  const ordered = parts
    .map((c) => {
      const i = c.indexOf('=')
      return { name: c.slice(0, i), value: c.slice(i + 1) }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  let raw = ordered.map((p) => p.value).join('')
  try { raw = decodeURIComponent(raw) } catch { /* already plain */ }
  if (raw.startsWith('base64-')) {
    raw = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8')
  }
  try { return JSON.parse(raw).access_token ?? null } catch { return null }
}

/** Ask the database, over HTTP, as this token. */
async function rpc(fn, token, body = {}) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${token ?? anon}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text }
}

console.log('\n== THE ADMIN GATE, over HTTP, with a real session ==')

let adminId = null
let plainId = null
try {
  adminId = await makeUser(ADMIN_EMAIL)
  plainId = await makeUser(PLAIN_EMAIL)
  /* The allowlist is a row, not a role — so granting is an INSERT. */
  sql(`insert into public.admins (email, note) values ('${ADMIN_EMAIL}', 'auth-probe')
       on conflict (email) do nothing`)

  // ─── 1. THE FLOW ITSELF ───────────────────────────────────────────────
  const hash = await mintTokenHash(ADMIN_EMAIL)
  ok('a magic link mints a token hash', typeof hash === 'string' && hash.length > 0,
    hash ? `${hash.slice(0, 12)}…` : 'no hashed_token returned')

  /* ═══ THE POINT OF THE WHOLE CHANGE ═══
     `signIn` is a BARE fetch: no cookie jar, no prior request, nothing this
     process stored when the link was minted. If the flow needed a browser-held
     secret, this could not possibly succeed — which is exactly what PKCE
     required and exactly what Phil's browser was losing between the request
     and the click. Against the old callback this assertion was unreachable:
     there was no token_hash branch at all, and the route answered
     "no code in callback". */
  const signedIn = await signIn(hash)
  ok('a token_hash link signs in with NO browser-stored secret — nothing was sent but the link',
    signedIn.location != null && !signedIn.location.includes('error='),
    'bare fetch, no cookies, no prior state')
  ok('the callback accepts a token_hash link and does NOT report an error',
    signedIn.location != null && !signedIn.location.includes('error='),
    `${signedIn.status} -> ${signedIn.location}`)
  ok('and it lands on the requested destination',
    (signedIn.location ?? '').endsWith('/admin/review'), signedIn.location ?? '(none)')
  ok('and it wrote session cookies in the route handler',
    signedIn.setCookie.length > 0, `${signedIn.setCookie.length} Set-Cookie headers`)

  const adminToken = accessTokenFrom(signedIn.jar)
  ok('the session cookie carries a usable access token', adminToken != null,
    adminToken ? `${adminToken.slice(0, 10)}…` : 'could not reassemble the chunked cookie')

  // ─── 1b. THE OPEN REDIRECT, PINNED BY SPELLING ───────────────────────
  /* `next` rides in a SIGN-IN LINK — the thing people forward — so a redirect
     that leaves our origin hands an attacker our domain, our branding and a
     real successful login before it lands somewhere else.
     Each spelling is asserted BY NAME because they are not variations on one
     bug, they are three different parser behaviours that happen to meet here,
     and a single "rejects a bad next" assertion would let the other two back
     in silently. */
  /* THE CONTROL RUNS FIRST, and it also establishes WHAT OUR ORIGIN IS.
     Comparing against BASE_URL looked obvious and was wrong: this probe talks
     to 127.0.0.1 while Next builds request.url from the Host header and
     answers `localhost`, so every bypass assertion "failed" on a host mismatch
     that had nothing to do with the redirect. Ask the app where it thinks it
     lives, then hold the bypasses to that. */
  let ourOrigin = null
  {
    const h = await mintTokenHash(ADMIN_EMAIL)
    const r = await signIn(h, 'magiclink', '/admin/review?filter=pending')
    const loc = r.location ?? ''
    ok('a legitimate next arrives intact — without this, refusing EVERYTHING would pass',
      loc.endsWith('/admin/review?filter=pending'), loc || '(none)')
    try { ourOrigin = new URL(loc).origin } catch { ourOrigin = null }
  }

  const REDIRECT_BYPASSES = [
    ['//evil.example', 'protocol-relative — the original second clause'],
    ['/\\evil.example', 'BACKSLASH — the URL spec folds \\ to /, so a guard written in terms of / never saw it'],
    ['/\t/evil.example', 'TAB — the parser STRIPS it, so //evil is what actually resolves'],
    ['/\n/evil.example', 'NEWLINE — same stripping, same escape'],
    ['https://evil.example/', 'absolute'],
  ]
  for (const [bad, why] of REDIRECT_BYPASSES) {
    const h = await mintTokenHash(ADMIN_EMAIL)
    const r = await signIn(h, 'magiclink', bad)
    const loc = r.location ?? ''
    let landedOrigin = null
    try { landedOrigin = new URL(loc).origin } catch { /* unparseable */ }
    ok(`next=${JSON.stringify(bad)} cannot leave our origin — ${why}`,
      ourOrigin != null && landedOrigin === ourOrigin && !/evil\.example/.test(loc),
      `landed on ${loc || '(no redirect)'}`)
  }

  // ─── 2. is_admin(), FROM THE DATABASE, AS THE SIGNED-IN USER ──────────
  const asAdmin = await rpc('is_admin', adminToken)
  ok('is_admin() is TRUE for an allowlisted email', asAdmin.json === true,
    `${asAdmin.status} ${asAdmin.text}`)

  const plainHash = await mintTokenHash(PLAIN_EMAIL)
  const plainSession = await signIn(plainHash)
  const plainToken = accessTokenFrom(plainSession.jar)
  ok('a non-admin can also sign in — the gate is authorisation, not authentication',
    plainToken != null && !(plainSession.location ?? '').includes('error='),
    plainSession.location ?? '(none)')

  const asPlain = await rpc('is_admin', plainToken)
  ok('is_admin() is FALSE for a signed-in NON-admin', asPlain.json === false,
    `${asPlain.status} ${asPlain.text}`)

  const asAnon = await rpc('is_admin', null)
  ok('is_admin() is FALSE for an anonymous caller', asAnon.json === false,
    `${asAnon.status} ${asAnon.text}`)

  // ─── 3. approve_change IS REFUSED FOR BOTH ───────────────────────────
  /* A real pending change, so the refusal is about WHO IS ASKING rather than
     about the row not existing — "no such pending change" would look like a
     refusal and prove nothing. */
  /* THE TARGET MUST BE WEB-RANKED, and it is CHOSEN rather than drawn.
     This said `order by r.id limit 1` — a random row per reset, since every id
     is a gen_random_uuid(). After the 2026-08-09 seed sync it started landing
     on a room the partner sheet had re-sourced, and the admin's approval was
     refused by PRECEDENCE (CID03) before authorisation was ever tested. The
     probe reported the admin being refused, which is the opposite of what this
     assertion is for.
     So: ask the database for a room whose hours_note is still web-ranked. That
     keeps this about WHO IS ASKING, which is the only thing this gate tests,
     and it re-derives itself the next time the data moves. */
  const webRoom = sql(`
    select r.id from public.rooms r
     where public.fact_source_kind('rooms', r.id, 'hours_note') = 'web'
     order by r.slug limit 1`)
  ok(webRoom !== '', 'a web-ranked room exists to test authorisation against',
    webRoom ? 'found one' : 'NONE — the assertion below would test precedence, not authorisation')

  const pcId = sql(`
    insert into public.pending_changes
      (target_table, target_id, room_id, operation, field, new_value, agent, source_url)
    values ('rooms', '${webRoom}'::uuid, '${webRoom}'::uuid, 'update', 'hours_note',
            '"auth-probe"'::jsonb, 'auth-probe', 'https://example.test/auth-probe')
    returning id`)

  const anonApprove = await rpc('approve_change', null, { p_id: pcId })
  ok('approve_change is REFUSED for an anonymous caller',
    anonApprove.status >= 400 && /not authorised|permission denied|42501/i.test(anonApprove.text),
    `${anonApprove.status} ${anonApprove.text.slice(0, 90)}`)

  const plainApprove = await rpc('approve_change', plainToken, { p_id: pcId })
  ok('approve_change is REFUSED for a signed-in NON-admin',
    plainApprove.status >= 400 && /not authorised|permission denied|42501/i.test(plainApprove.text),
    `${plainApprove.status} ${plainApprove.text.slice(0, 90)}`)

  /* THE POSITIVE CONTROL. Without it, every refusal above is satisfied by a
     function that refuses everyone — which is not a gate, it is a wall. */
  const adminApprove = await rpc('approve_change', adminToken, { p_id: pcId })
  ok('...and ACCEPTED for the admin — the refusals above are a gate, not a wall',
    adminApprove.status < 400, `${adminApprove.status} ${adminApprove.text.slice(0, 90)}`)

  sql(`delete from public.pending_changes where agent = 'auth-probe'`)
  sql(`delete from public.change_log where agent = 'auth-probe'`)
  sql(`update public.rooms set hours_note = null where hours_note = 'auth-probe'`)

} finally {
  // ─── CLEAN UP. An allowlist row left behind is a real privilege granted. ──
  sql(`delete from public.admins where email in ('${ADMIN_EMAIL}', '${PLAIN_EMAIL}')`)
  if (adminId) await deleteUser(adminId)
  if (plainId) await deleteUser(plainId)
  const left = sql(`select count(*) from public.admins where email like 'cid-probe-%'`)
  ok('the probe left no admin row behind', left === '0', `${left} remaining`)
}

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
