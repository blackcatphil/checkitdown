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
 * SINCE 2026-08-12 IT ALSO DRIVES THE PASSWORD PATH (section 4), because
 * SignIn.tsx offers one. `signInWithPassword` is `POST /token?grant_type=
 * password`, so the probe calls that endpoint and re-runs every refusal in
 * section 3 against the session it mints. The claim being tested is that the
 * two doors open into the same room — a password proves you are an ACCOUNT and
 * the allowlist is still a row in `admins`, so it cannot be a way to become an
 * admin. A positive control keeps that from passing on an inert feature.
 *
 * IT CLEANS UP AFTER ITSELF. Both test users are deleted and the admin row is
 * removed, asserted at the end — an allowlist row left behind is a real
 * privilege granted by a test run.
 */
import { execFileSync } from 'node:child_process'

import { resolvePsql } from './psql-path.mjs'
import { localTarget } from './db-target.mjs'

const PSQL = resolvePsql()
const DB = localTarget('auth-probe')
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

/** Give a user a password, the way Phil will in the Supabase dashboard. */
async function setPassword(id, password) {
  const res = await fetch(`${API}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`could not set a password: ${res.status} ${await res.text()}`)
}

/**
 * Sign in with a password. This is the exact request the form makes —
 * `supabase.auth.signInWithPassword` IS `POST /token?grant_type=password` with
 * the anon key — so driving the endpoint drives the button.
 */
async function passwordSignIn(email, password) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, session: json, text }
}

/**
 * ⚠️ THE COOKIE NAME IS LEARNED, NOT GUESSED.
 *
 * A password sign-in writes its cookie in the BROWSER — there is no route
 * handler to hand this probe a Set-Cookie header, which is how the magic-link
 * assertions above get their jar. So the jar is built here instead, and the
 * only part that could be wrong is the name @supabase/ssr chose for it. That is
 * taken from a real magic-link cookie observed moments earlier rather than
 * hard-coded: the project ref, the chunk separator and the `base64-` framing
 * are all read off the genuine article. A guessed name would produce a jar the
 * app ignores, and "the app ignored my cookie" looks exactly like "the app
 * refused me" — which is the one thing this section must never confuse.
 */
function jarFor(session, observedSetCookie) {
  const names = observedSetCookie
    .map((c) => c.split('=')[0])
    .filter((n) => /^sb-.*-auth-token/.test(n))
  if (names.length === 0) throw new Error('no auth cookie was observed to learn the name from')
  const base = names[0].slice(0, names[0].indexOf('-auth-token') + '-auth-token'.length)
  const sep = names[0].length > base.length ? names[0][base.length] : '.'
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64')}`
  if (value.length <= 3180) return `${base}=${value}`
  const chunks = value.match(/.{1,3180}/g) ?? []
  return chunks.map((c, i) => `${base}${sep}${i}=${c}`).join('; ')
}

/** Fetch a page of the app as whoever this jar is. */
async function pageAs(path, jar) {
  const res = await fetch(`${APP}${path}`, { headers: { cookie: jar }, redirect: 'manual' })
  return { status: res.status, body: await res.text() }
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

  /* A SECOND pending change, for section 4. The one above is CONSUMED by its
     positive control — approving it applies it and clears the row — so reusing
     it there would test "no such pending change", which refuses everybody and
     proves nothing about who is asking.
     ⚠️ AND THE ADMIN GETS A THIRD, NOT A SHARE OF THE SECOND. Sharing one row
     was caught by red-proving this section: under an injected is_admin() the
     stranger's approval SUCCEEDED and consumed the row, so the admin's control
     then failed with "change already applied" — a real failure reported under
     the wrong name. Each assertion approves a row nothing else touches. */
  const [pcId2, pcId3] = ['pw-stranger', 'pw-admin'].map((tag) => sql(`
    insert into public.pending_changes
      (target_table, target_id, room_id, operation, field, new_value, agent, source_url)
    values ('rooms', '${webRoom}'::uuid, '${webRoom}'::uuid, 'update', 'hours_note',
            to_jsonb('auth-probe-' || '${tag}'), 'auth-probe', 'https://example.test/auth-probe')
    returning id`))

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

  // ─── 4. THE PASSWORD PATH: A SECOND DOOR INTO THE SAME ROOM ──────────
  /**
   * ⚠️ WHAT THIS SECTION EXISTS TO MAKE IMPOSSIBLE.
   *
   * SignIn.tsx now offers a password alongside the magic link, and the obvious
   * way to get that wrong is to treat "has a password" as "is an admin" — a
   * shared site password, a gate on the page and nothing behind it. That
   * version would render the queue and then fail every approval, because
   * `approve_change` authorises internally against `is_admin()` and does not
   * care which page called it.
   *
   * So every refusal in section 3 is re-run against a session minted by a
   * PASSWORD rather than a link. Not because the code path differs — it does
   * not, and that is the claim — but because "it does not differ" is exactly
   * the kind of thing that is true until someone adds a shortcut.
   */
  const PW_ADMIN = 'cid-probe-pw-Adm1n!' + adminId.slice(0, 8)
  const PW_PLAIN = 'cid-probe-pw-Str4ng3r!' + plainId.slice(0, 8)
  await setPassword(adminId, PW_ADMIN)
  await setPassword(plainId, PW_PLAIN)

  const pwPlain = await passwordSignIn(PLAIN_EMAIL, PW_PLAIN)
  const pwPlainToken = pwPlain.session?.access_token ?? null
  /* AUTHENTICATION WORKS — and it must, or every refusal below passes because
     nobody got in at all. */
  ok('a NON-allowlisted account CAN sign in with a password — the password is authentication',
    pwPlainToken != null, `${pwPlain.status} ${pwPlainToken ? 'token minted' : pwPlain.text.slice(0, 80)}`)

  const pwPlainIsAdmin = await rpc('is_admin', pwPlainToken)
  ok('is_admin() is FALSE for a PASSWORD session that is not on the allowlist',
    pwPlainIsAdmin.json === false, `${pwPlainIsAdmin.status} ${pwPlainIsAdmin.text}`)

  /* THE SCREEN ITSELF, not just the verdict behind it. The page builds its
     copy from whoAmI(), so this is what Phil would actually see. */
  const plainJar = jarFor(pwPlain.session, signedIn.setCookie)
  const plainPage = await pageAs('/admin', plainJar)
  ok('...and the app RECOGNISES that session — otherwise the assertion below '
    + 'would pass on a cookie the app simply ignored',
    plainPage.body.includes(PLAIN_EMAIL),
    plainPage.body.includes(PLAIN_EMAIL) ? 'the page names the signed-in address' : 'the page does not name it')
  ok('/admin tells a password-signed-in stranger they are NOT on the allowlist',
    plainPage.body.includes('is signed in but not on the admin allowlist'),
    `${plainPage.status}`)

  const pwPlainApprove = await rpc('approve_change', pwPlainToken, { p_id: pcId2 })
  ok('approve_change is REFUSED for a PASSWORD session that is not on the allowlist',
    pwPlainApprove.status >= 400 && /not authorised|permission denied|42501/i.test(pwPlainApprove.text),
    `${pwPlainApprove.status} ${pwPlainApprove.text.slice(0, 90)}`)

  /* ═══ THE POSITIVE CONTROL, AND IT IS NOT OPTIONAL ═══
     Without it all four assertions above are satisfied by a password path that
     mints a token carrying no identity at all — is_admin() would answer false
     for everyone, approve_change would refuse everyone, and this section would
     report a working gate while the feature was inert. The admin signing in
     with a PASSWORD has to reach the same place the link takes them. */
  const pwAdmin = await passwordSignIn(ADMIN_EMAIL, PW_ADMIN)
  const pwAdminToken = pwAdmin.session?.access_token ?? null
  const pwAdminIsAdmin = await rpc('is_admin', pwAdminToken)
  ok('is_admin() is TRUE for the SAME allowlisted account signed in by password',
    pwAdminIsAdmin.json === true, `${pwAdminIsAdmin.status} ${pwAdminIsAdmin.text}`)

  /* ⚠️ ASSERTED AS A PRESENCE FIRST, AND THAT ORDER IS THE POINT.
     "does NOT show the not-on-the-allowlist screen" is satisfied by a page that
     ignored the cookie entirely — a signed-OUT /admin does not contain that
     sentence either, so a jar the app never read would sail through. The queue
     link is rendered only for `isAdmin`, so it cannot be produced by a session
     the app failed to see. The absence is still asserted, but behind something
     that has to be there. */
  const adminPage = await pageAs('/admin', jarFor(pwAdmin.session, signedIn.setCookie))
  ok('...and /admin OFFERS THEM THE QUEUE — rendered for isAdmin only, so an '
    + 'ignored cookie cannot fake it',
    adminPage.body.includes('Open the queue'), `${adminPage.status}`)
  ok('...and does not also show them the not-on-the-allowlist screen',
    !adminPage.body.includes('is signed in but not on the admin allowlist'),
    `${adminPage.status}`)

  const pwAdminApprove = await rpc('approve_change', pwAdminToken, { p_id: pcId3 })
  ok('...and approve_change ACCEPTS them — a password is a way to prove you are '
    + 'an account, not a way to become an admin',
    pwAdminApprove.status < 400, `${pwAdminApprove.status} ${pwAdminApprove.text.slice(0, 90)}`)

  sql(`delete from public.pending_changes where agent = 'auth-probe'`)
  sql(`delete from public.change_log where agent = 'auth-probe'`)
  sql(`update public.rooms set hours_note = null
        where hours_note like 'auth-probe%'`)

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
