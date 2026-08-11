import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INSTALL_URL, isPlatform, platformFromUserAgent } from './install.ts'

/* Real strings, copied from real browsers, rather than the shapes the regex was
   written against. A detector tested on its own assumptions passes forever. */
const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadOld: 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxCi: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
}

test('iOS is recognised in Safari and in the other browsers that wrap it', () => {
  assert.equal(platformFromUserAgent(UA.iphoneSafari), 'ios')
  assert.equal(platformFromUserAgent(UA.iphoneChrome), 'ios')
  assert.equal(platformFromUserAgent(UA.ipadOld), 'ios')
})

test('Android is recognised across the three browsers people actually use there', () => {
  assert.equal(platformFromUserAgent(UA.androidChrome), 'android')
  assert.equal(platformFromUserAgent(UA.androidFirefox), 'android')
  assert.equal(platformFromUserAgent(UA.androidSamsung), 'android')
})

test('desktop is the fallback, including for a missing header', () => {
  assert.equal(platformFromUserAgent(UA.macChrome), 'desktop')
  assert.equal(platformFromUserAgent(UA.windows), 'desktop')
  assert.equal(platformFromUserAgent(UA.linuxCi), 'desktop')
  assert.equal(platformFromUserAgent(null), 'desktop')
  assert.equal(platformFromUserAgent(''), 'desktop')
})

/**
 * THE KNOWN WRONG ANSWER, PINNED AS AN ASSERTION RATHER THAN A COMMENT.
 *
 * An iPad in its default configuration sends a Macintosh user agent, so this
 * function calls it desktop and it is a tablet that can absolutely add the site
 * to its home screen. Asserting the WRONG answer looks odd until you consider
 * the alternative: somebody "fixes" the regex to guess iOS from a Mac UA, and
 * every laptop in the building starts being told to tap a Share button it does
 * not have. The client-side correction and the switcher exist because this line
 * is true, so the line is the thing to test.
 */
test('an iPad asking for desktop sites reads as desktop, which the client corrects', () => {
  assert.equal(platformFromUserAgent(UA.ipadDesktopMode), 'desktop')
  assert.equal(platformFromUserAgent(UA.macChrome), 'desktop')
})

test('the platform override only accepts the three it knows', () => {
  assert.ok(isPlatform('ios'))
  assert.ok(isPlatform('android'))
  assert.ok(isPlatform('desktop'))
  assert.ok(!isPlatform('windows'))
  assert.ok(!isPlatform(undefined))
  assert.ok(!isPlatform(''))
})

test('the QR encodes the install page, on the production host, with no query string', () => {
  assert.equal(INSTALL_URL, 'https://checkitdown.com/install')
})
