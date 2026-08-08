'use client'

import { useEffect } from 'react'

/**
 * Registers the shell-only service worker (`public/sw.js`).
 *
 * A service worker with a fetch handler is what makes the app installable —
 * "add to home screen" on Android will not offer the prompt without one. What
 * it must NOT do is cache facts; that ruling lives, commented at length, in
 * `sw.js` itself, because that is the file someone will edit when they want
 * offline support and it is the file that has to argue back.
 *
 * Registration is deliberately unconditional rather than production-only: a
 * worker that only exists in production is a worker nobody tests, and the
 * offline behaviour is asserted by `scripts/pwa-probe.mjs` against a dev
 * server.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    /* `load` rather than immediately: registration competes with the first
       paint for bandwidth, and the map is already the heaviest thing here. */
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* An unregistrable worker is not a broken app — it is an app that
           cannot be installed. Silent by design. */
      })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])
  return null
}
