#!/usr/bin/env node
/**
 * THE PASSWORD RECOVERY ROUTE, END TO END, THROUGH A REAL BROWSER.
 *
 * Until 2026-08-15 this project had no recovery path. Supabase's reset email
 * pointed at the project's Site URL — `https://checkitdown.com`, the homepage —
 * which reads no token and does nothing with it. The visit still CONSUMED the
 * token, so the reader could not even retry, and the only way to set a password
 * was to write to `auth.users` by hand.
 *
 * ⚠️ WHY THIS NEEDS A BROWSER AND auth-probe.mjs DID NOT.
 *
 * A magic link carries `token_hash` in the QUERY, so a route handler can read
 * it and a bare `fetch` can drive the whole flow. A recovery link goes to
 * GoTrue's own `/auth/v1/verify`, which consumes the token and 303s to us with
 * the session in the URL FRAGMENT — and a fragment is never sent to a server.
 * `fetch` can see the redirect, but nothing server-side can act on what is in
 * it. The page under test is therefore a client component, and the only honest
 * rig for it is a browser that actually receives the fragment.
 *
 * ⚠️ WHAT THIS ASSERTS THAT "IT WORKED" WOULD NOT.
 *
 * A reset page that accepts a SPENT token is worse than no reset page: it turns
 * a link forwarded, logged or left in a mail archive into a standing key. So
 * each refusal is forced separately — expired, already used, not on the
 * allowlist — and each asserts the FORM IS ABSENT rather than that some error
 * appeared. And the loop ends by proving the OLD password stops working, which
 * is the difference between a reset and an addition.
 *
 * IT CLEANS UP AFTER ITSELF. Both users are deleted and the allowlist row is
 * removed, asserted at the end.
 */
import { execFileSync } from 'node:child_process'

import { chromium } from 'playwright'

import { resolvePsql } from './psql-path.mjs'
import { localTarget } from './db-target.mjs'

const PSQL = resolvePsql()
const DB = localTarget('recovery-probe')
const APP = process.env.BASE_URL ?? 'http://127.0.0.1:3000'
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'

const sql = (q) => execFileSync(PSQL, [DB, '-qtAX', '-c', q], { encoding: 'utf8' }).trim()

/* Local-stack keys, read from the CLI rather than pasted — same as auth-probe. */
function keys() {
  if (process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY }
  }
  let raw = null
  for (const [cmd, args] of [
    ['supabase', ['status', '-o', 'json']],
    ['npx', ['supabase', 'status', '-o', 'json']],
  ]) {
    try { raw = execFileSync(cmd, args, { encoding: 'utf8' }); break } catch { /* try the next */ }
  }
  if (raw == null) throw new Error('could not read the local stack keys — is `supabase start` running?')
  const j = JSON.parse(raw)
  return { anon: j.ANON_KEY, service: j.SERVICE_ROLE_KEY }
}

let failed = 0
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failed++
}

const ADMIN_EMAIL = 'cid-recovery-admin@example.test'
const PLAIN_EMAIL = 'cid-recovery-stranger@example.test'
const OLD_PASSWORD = 'cid-recovery-OLD-p4ssw0rd!'
const NEW_PASSWORD = 'cid-recovery-NEW-p4ssw0rd!'

const { anon, service } = keys()
const svc = { apikey: service, Authorization: `Bearer ${service}` }

async function makeUser(email, password) {
  const res = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (res.ok) return (await res.json()).id
  const list = await fetch(`${API}/auth/v1/admin/users?page=1&per_page=200`, { headers: svc })
  const found = (await list.json()).users?.find((u) => u.email === email)
  if (!found) throw new Error(`could not create or find ${email}: ${await res.text()}`)
  /* Reuse from a previous run — force the password back to the known one. */
  await fetch(`${API}/auth/v1/admin/users/${found.id}`, {
    method: 'PUT',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  return found.id
}

const deleteUser = (id) =>
  fetch(`${API}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc })

/**
 * The link the reset email would carry.
 *
 * `generate_link` returns the SAME `action_link` GoTrue puts in the mail, so
 * this drives the real artefact rather than a reconstruction of it — the same
 * reason auth-probe mints its token hash this way.
 */
async function mintRecoveryLink(email) {
  const res = await fetch(`${API}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'recovery', email, redirect_to: `${APP}/admin/password` }),
  })
  if (!res.ok) throw new Error(`generate_link failed: ${res.status} ${await res.text()}`)
  const j = await res.json()
  return j.action_link ?? j.properties?.action_link
}

/**
 * Follow the email link exactly as a click would, and report where it lands.
 * `redirect: 'manual'` because the payload we care about is in the Location
 * header's fragment, and following the redirect would discard it.
 */
async function followLink(link) {
  const res = await fetch(link, { redirect: 'manual' })
  const loc = res.headers.get('location') ?? ''
  const hash = loc.includes('#') ? loc.slice(loc.indexOf('#')) : ''
  return { status: res.status, location: loc, hash, params: new URLSearchParams(hash.replace(/^#/, '')) }
}

/** Sign in over HTTP, the way the form does. */
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

const browser = await chromium.launch()

/** Load /admin/password with a fragment, and report what the page decided. */
async function landOn(hash, { standalone = false } = {}) {
  const ctx = await browser.newContext()
  if (standalone) {
    await ctx.addInitScript(`(() => {
      const real = window.matchMedia.bind(window)
      window.matchMedia = (q) => (/display-mode:\\s*standalone/.test(q)
        ? { matches: true, media: q, onchange: null, addEventListener() {},
            removeEventListener() {}, dispatchEvent() { return false },
            addListener() {}, removeListener() {} }
        : real(q))
    })()`)
  }
  const page = await ctx.newPage()
  await page.goto(`${APP}/admin/password${hash}`, { waitUntil: 'load' })
  /* The gate resolves asynchronously — it calls the auth server and then the
     database. Wait for it to stop saying "checking" rather than for a timeout. */
  await page.waitForFunction(
    () => document.querySelector('[data-password]')?.dataset.password !== 'checking',
    null, { timeout: 15_000 },
  ).catch(() => {})
  const seen = await page.evaluate(() => ({
    marker: document.querySelector('[data-password]')?.dataset.password ?? null,
    /* ⚠️ THE COMPONENT'S OWN TEXT, NOT THE DOCUMENT'S. `document.body.textContent`
       includes Next's inlined RSC payload, so a copy assertion written against it
       can match a string that appears nowhere a reader can see — and every failure
       detail prints a wall of flight data instead of the sentence in question. */
    text: document.querySelector('[data-password]')?.textContent ?? '',
    hasPasswordInput: document.querySelector('#new-password') != null,
    urlHash: window.location.hash,
  }))
  return { ctx, page, ...seen }
}

console.log('\n== THE RECOVERY ROUTE, through a real browser ==')

let adminId = null
let plainId = null
try {
  adminId = await makeUser(ADMIN_EMAIL, OLD_PASSWORD)
  plainId = await makeUser(PLAIN_EMAIL, OLD_PASSWORD)
  sql(`insert into public.admins (email, note) values ('${ADMIN_EMAIL}', 'recovery-probe')
       on conflict (email) do nothing`)

  // ─── 0. THE BUG THIS ROUTE EXISTS FOR, RECORDED AS AN ASSERTION ────────
  /* Without `redirect_to` the link lands on the Site URL. This is what the
     reader met before: a homepage that reads no token, having just spent it. */
  {
    const res = await fetch(`${API}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email: ADMIN_EMAIL }),
    })
    const bare = (await res.json()).action_link
    const landed = await followLink(bare)
    const base = landed.location.split('#')[0]
    ok('a recovery link with NO redirect_to lands on the site root, which reads no token',
      base.replace(/\/$/, '') === (process.env.SITE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, ''),
      base || '(no redirect)')
    ok('...and it still carries a real session in the FRAGMENT, which no server can see',
      landed.params.get('access_token') != null,
      'this is why the token was spent and nothing happened')
  }

  // ─── 1. REFUSAL: A TOKEN THAT HAS ALREADY BEEN USED ───────────────────
  {
    const link = await mintRecoveryLink(ADMIN_EMAIL)
    const first = await followLink(link)
    ok('a fresh recovery link verifies and redirects to /admin/password',
      first.location.startsWith(`${APP}/admin/password`) && first.params.get('access_token') != null,
      first.location.split('#')[0] || '(none)')

    const second = await followLink(link)
    ok('RED — the SAME link followed twice is refused by the auth server',
      second.params.get('error') != null || second.params.get('error_code') != null,
      second.params.get('error_code') ?? second.params.get('error') ?? 'no error in the fragment')

    const landed = await landOn(second.hash)
    ok('RED — and the page REFUSES a consumed link: no password field at all',
      landed.marker === 'refused' && landed.hasPasswordInput === false,
      `marker=${landed.marker}, password field present=${landed.hasPasswordInput}`)
    /* ⚠️ THE REFUSAL MUST BE THE RIGHT ONE. "No password field" is satisfied by
       EVERY refusal, including "there is no link here" — which is what this
       page actually rendered until the double-invoked effect was fixed, with
       this assertion's weaker predecessor passing on it. */
    ok('...and it says the link is SPENT, not that there was no link',
      /expired or has already been used/i.test(landed.text)
        && !/no reset link on this page/i.test(landed.text),
      landed.text.replace(/\s+/g, ' ').slice(-120))
    await landed.ctx.close()
  }

  // ─── 2. REFUSAL: AN EXPIRED TOKEN ─────────────────────────────────────
  {
    const link = await mintRecoveryLink(ADMIN_EMAIL)
    /* Age the token rather than waiting an hour. GoTrue measures expiry from
       `recovery_sent_at`, so moving that back is the same clock the server
       reads — not a stub of it. */
    sql(`update auth.users set recovery_sent_at = now() - interval '25 hours'
          where email = '${ADMIN_EMAIL}'`)
    const landedHash = await followLink(link)
    ok('RED — an aged link is refused by the auth server',
      landedHash.params.get('error_code') === 'otp_expired'
        || landedHash.params.get('error') != null,
      landedHash.params.get('error_code') ?? 'no error code')

    const landed = await landOn(landedHash.hash)
    ok('RED — and the page REFUSES an expired link: no password field at all',
      landed.marker === 'refused' && landed.hasPasswordInput === false,
      `marker=${landed.marker}, password field present=${landed.hasPasswordInput}`)
    ok('...and for the LINK being expired, not for there being no link',
      /expired or has already been used/i.test(landed.text)
        && !/no reset link on this page/i.test(landed.text),
      landed.text.replace(/\s+/g, ' ').slice(-120))
    await landed.ctx.close()
  }

  // ─── 3. REFUSAL: A VALID TOKEN FOR AN ADDRESS OFF THE ALLOWLIST ───────
  {
    const link = await mintRecoveryLink(PLAIN_EMAIL)
    const landedHash = await followLink(link)
    /* THE TOKEN IS GOOD. That is the whole point of this case: the refusal
       must come from the allowlist, not from a broken link. */
    ok('a NON-allowlisted address gets a perfectly valid recovery link',
      landedHash.params.get('access_token') != null,
      'the token verifies — so the refusal below is about authorisation')

    const landed = await landOn(landedHash.hash)
    ok('RED — the page REFUSES a valid link for an address off the allowlist',
      landed.marker === 'refused' && landed.hasPasswordInput === false,
      `marker=${landed.marker}, password field present=${landed.hasPasswordInput}`)
    ok('...and it names the address rather than pretending the link was bad',
      landed.text.includes(PLAIN_EMAIL) && /not on the admin allowlist/i.test(landed.text)
        && !/expired or has already been used/i.test(landed.text),
      landed.text.replace(/\s+/g, ' ').slice(-120))

    /* ⚠️ AND THE SESSION IS GONE, NOT MERELY HIDDEN. A refusal that leaves a
       live session behind a hidden form is a form you can re-render. */
    const stillIn = await landed.page.evaluate(async () => {
      const keys = Object.keys(window.localStorage)
      return { ls: keys.filter((k) => /auth-token/.test(k)).length, cookie: document.cookie }
    })
    ok('...and the refused session is SIGNED OUT, not just hidden from the DOM',
      stillIn.ls === 0 && !/auth-token/.test(stillIn.cookie),
      `localStorage auth keys: ${stillIn.ls}; auth cookie present: ${/auth-token/.test(stillIn.cookie)}`)
    await landed.ctx.close()
  }

  // ─── 3b. THE FOURTH REFUSAL: NO LINK AT ALL ──────────────────────────
  /* Asserted in its own right, because it is the copy the three refusals above
     must NOT show — and a wording that exists only as somebody else's failure
     mode is a wording nobody ever checks. */
  {
    const landed = await landOn('')
    ok('RED — /admin/password with no link at all offers no password field',
      landed.marker === 'refused' && landed.hasPasswordInput === false,
      `marker=${landed.marker}`)
    ok('...and says THAT, rather than blaming a link nobody followed',
      /no reset link on this page/i.test(landed.text)
        && !/expired or has already been used/i.test(landed.text),
      landed.text.replace(/\s+/g, ' ').slice(-110))
    await landed.ctx.close()
  }

  // ─── 3c. THE OTHER LINK SHAPE: token_hash THROUGH /auth/callback ─────
  /**
   * ⚠️ NOT HYPOTHETICAL. This project's MAGIC-LINK email template was already
   * customised to render `{{ .TokenHash }}` (see app/auth/callback/route.ts).
   * If the RECOVERY template is ever pointed the same way, the link stops
   * carrying a fragment and starts carrying a query — and arrives here with
   * cookies already written by the route handler instead.
   *
   * The callback already accepts `type=recovery`, so that shape works today.
   * Asserting it means the page is correct under EITHER template, and Phil does
   * not have to know which one is configured for the reset to work.
   */
  {
    const res = await fetch(`${API}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email: ADMIN_EMAIL }),
    })
    const hash = (await res.json()).hashed_token
    const cb = await fetch(
      `${APP}/auth/callback?token_hash=${encodeURIComponent(hash)}&type=recovery`
      + `&next=${encodeURIComponent('/admin/password')}`,
      { redirect: 'manual' },
    )
    ok('a token_hash RECOVERY link is accepted by /auth/callback and lands on the page',
      (cb.headers.get('location') ?? '').endsWith('/admin/password'),
      cb.headers.get('location') ?? '(no redirect)')

    const jar = (cb.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='))
      .map((c) => {
        const i = c.indexOf('=')
        return { name: c.slice(0, i), value: c.slice(i + 1), domain: '127.0.0.1', path: '/' }
      })
    const ctx = await browser.newContext()
    await ctx.addCookies(jar)
    const page = await ctx.newPage()
    await page.goto(`${APP}/admin/password`, { waitUntil: 'load' })
    await page.waitForFunction(
      () => document.querySelector('[data-password]')?.dataset.password !== 'checking',
      null, { timeout: 15_000 },
    ).catch(() => {})
    const marker = await page.evaluate(
      () => document.querySelector('[data-password]')?.dataset.password ?? null)
    ok('...and the page works from COOKIES with no fragment at all — correct '
      + 'under either email template',
      marker === 'ready', `marker=${marker}`)
    await ctx.close()
  }

  // ─── 4. THE INSTALLED APP ─────────────────────────────────────────────
  {
    const landed = await landOn('', { standalone: true })
    ok('the installed app is told a reset link cannot finish there, and why',
      landed.marker === 'refused' && /installed app/i.test(landed.text)
        && /do not share a session/i.test(landed.text),
      landed.marker ?? 'no marker')
    await landed.ctx.close()
  }

  // ─── 5. THE LOOP, END TO END ──────────────────────────────────────────
  {
    /* The ageing in section 2 is still on the row; a new link resets it. */
    const before = await passwordSignIn(ADMIN_EMAIL, OLD_PASSWORD)
    ok('CONTROL: the OLD password works before the reset — otherwise step 5 '
      + 'proves nothing about what the reset changed',
      before.session?.access_token != null, `${before.status}`)

    const link = await mintRecoveryLink(ADMIN_EMAIL)
    const landedHash = await followLink(link)
    const landed = await landOn(landedHash.hash)
    ok('a valid link for an ALLOWLISTED address reaches the form',
      landed.marker === 'ready' && landed.hasPasswordInput === true,
      `marker=${landed.marker}`)
    ok('...and the tokens are stripped from the address bar — a session in a '
      + 'URL ends up in history, bookmarks and screenshots',
      landed.urlHash === '', `location.hash = ${JSON.stringify(landed.urlHash)}`)

    await landed.page.fill('#new-password', NEW_PASSWORD)
    await landed.page.fill('#confirm-password', NEW_PASSWORD)
    await landed.page.click('button[type=submit]')
    await landed.page.waitForURL(/\/admin\/review/, { timeout: 15_000 }).catch(() => {})
    ok('setting the password lands on the review queue, signed in',
      /\/admin\/review/.test(landed.page.url()), landed.page.url())
    await landed.ctx.close()

    const withNew = await passwordSignIn(ADMIN_EMAIL, NEW_PASSWORD)
    ok('the NEW password signs in', withNew.session?.access_token != null,
      `${withNew.status} ${withNew.session?.access_token ? 'token minted' : withNew.text.slice(0, 70)}`)

    /* ⚠️ THE ASSERTION THAT MAKES IT A RESET. A flow that adds a credential
       without retiring the old one has changed nothing an attacker holding the
       old one would notice. */
    const withOld = await passwordSignIn(ADMIN_EMAIL, OLD_PASSWORD)
    ok('RED — the OLD password STOPS working: a reset that leaves the previous '
      + 'credential live is not a reset',
      withOld.status >= 400 && withOld.session?.access_token == null,
      `${withOld.status} ${withOld.text.slice(0, 70)}`)
  }

} finally {
  await browser.close()
  sql(`delete from public.admins where email like 'cid-recovery-%'`)
  if (adminId) await deleteUser(adminId)
  if (plainId) await deleteUser(plainId)
  const left = sql(`select count(*) from public.admins where email like 'cid-recovery-%'`)
  ok('the probe left no admin row behind', left === '0', `${left} remaining`)
}

console.log(`\n  ${failed} failed\n`)
process.exit(failed ? 1 : 0)
