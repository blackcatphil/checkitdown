/* =====================================================================
   SERVICE WORKER — SHELL ONLY. NEVER FACTS.
   =====================================================================
   Installability wants a fetch handler, and the instinct is to cache for
   offline. That instinct is wrong for this product specifically.

   A cached rake figure served tomorrow is a stale fact presented as
   current — the exact failure this whole product exists to prevent, and
   WORSE than a blank screen because it looks fine. There is no dotted
   rule, no tilde and no "checked on" date that can save a number the
   browser handed back from disk: every provenance marker on the page was
   rendered at cache time and is now part of the lie.

   So the rule is absolute and the code below has no exceptions to it:

     SHELL      cache-first. Content-hashed build assets, icons, the
                manifest, the offline page. These cannot go stale — a
                hashed URL is a different URL when its content changes.
     PAGES      network-first, and the response is NEVER cached. Offline
                serves an honest offline state instead.
     DATA       network only. No cache read, no cache write, no
                stale-while-revalidate. Not once.

   There is deliberately no `stale-while-revalidate` anywhere in this
   file. It is the right pattern for an avatar and the wrong one for a
   rake cap, and having it present for "safe" resources is how it ends up
   applied to an unsafe one six months later.
   ===================================================================== */

const VERSION = 'cid-shell-v1'
const OFFLINE_URL = '/offline'

/* Precached at install: the offline page must be available at the moment
   the network is not, so it cannot be fetched lazily. */
const SHELL = [OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      /* A missing shell file must not block installation — an app that
         will not install because an icon 404'd is worse than one with a
         default icon. */
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Immutable by construction: Next content-hashes these filenames. */
const isBuildAsset = (url) => url.pathname.startsWith('/_next/static/')

/** Files we ship whole and replace by deploy, never by content. */
const isShellAsset = (url) =>
  SHELL.includes(url.pathname)
  || /\.(png|svg|ico|woff2?)$/.test(url.pathname)
  || url.pathname === '/manifest.webmanifest'

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  /* Only this origin. A cross-origin tile or font is somebody else's
     cache policy and not ours to override. */
  if (url.origin !== self.location.origin) return
  /* Never interfere with a write. */
  if (req.method !== 'GET') return

  if (isBuildAsset(url) || isShellAsset(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        /* Only store a real response. Caching a 404 makes it permanent. */
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy))
        }
        return res
      })),
    )
    return
  }

  /* NAVIGATION — network-first, and the result is never written to the
     cache. The fallback is the offline page, NOT the last copy of this
     page: "here is what we could not reach" instead of yesterday's rake
     wearing today's date. Same family as "not yet checked on site" —
     an honest absence beats a confident wrong answer. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then(
        (hit) => hit ?? new Response(
          'Offline — we cannot reach the data.',
          { status: 503, headers: { 'Content-Type': 'text/plain' } },
        ),
      )),
    )
    return
  }

  /* EVERYTHING ELSE is data — RSC payloads, route handlers, anything the
     page reads to put a number on screen. Network only. If it fails, it
     fails, and the page says so. No `caches.match` on this path, ever. */
})
