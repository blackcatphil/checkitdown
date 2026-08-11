'use client'

import { useEffect } from 'react'

import { captureInstallPrompt } from '@/lib/install-prompt'

/**
 * Sits in the root layout for one reason: `beforeinstallprompt` fires once, on
 * the page the reader landed on, and the only route to /install is a link from
 * somewhere else. A listener mounted on /install would be mounted after the
 * event it exists to catch. See `lib/install-prompt.ts`.
 *
 * Renders nothing, and suppresses the browser's own install banner on every
 * route as a side effect — which is the ruling: one quiet link in the footer,
 * no interstitial and no banner on the map.
 */
export function InstallPromptCapture() {
  useEffect(() => { captureInstallPrompt() }, [])
  return null
}
