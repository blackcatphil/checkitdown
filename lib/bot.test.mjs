import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOT_RULES_VERSION, isBot } from './bot.ts'

/**
 * ⚠️ A FILTER THAT CANNOT FAIL IS NOT A FILTER.
 *
 * "We exclude bots" is an unfalsifiable claim unless something proves the
 * classifier says yes to a bot AND no to a person. Both directions are asserted
 * here against real user-agent strings, because a classifier tested only on the
 * shapes its own regex was written against passes forever.
 */

const BOTS = {
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  twitter: 'Twitterbot/1.0',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  curl: 'curl/8.4.0',
  python: 'python-requests/2.31.0',
  /* ⚠️ OUR OWN PROBES. Every browser gate in this repo drives headless
     Chromium, and a CI run must not look like traffic. */
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
  lighthouse: 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
}

const PEOPLE = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
}

test('every known bot is flagged', () => {
  for (const [name, ua] of Object.entries(BOTS)) {
    assert.equal(isBot(ua), true, `${name} was not flagged: ${ua}`)
  }
})

/**
 * THE HALF THAT MAKES THE OTHER HALF MEAN SOMETHING. A classifier that
 * returned true for everything would pass the test above and delete all the
 * data — which is the failure that looks like a working filter.
 */
test('and no real browser is', () => {
  for (const [name, ua] of Object.entries(PEOPLE)) {
    assert.equal(isBot(ua), false, `${name} was wrongly flagged as a bot: ${ua}`)
  }
})

/**
 * ⚠️ AN ABSENT UA IS A BOT. Every real browser sends one; a request without it
 * is a script that did not bother. Treating unknown as human is the direction
 * that inflates the numbers we would act on.
 */
test('a missing or empty user-agent counts as a bot, not as a person', () => {
  assert.equal(isBot(null), true)
  assert.equal(isBot(undefined), true)
  assert.equal(isBot(''), true)
  assert.equal(isBot('   '), true)
})

test('the classifier version is stored with the answer, and looks like a version', () => {
  /* Without this the filter is unfalsifiable: a re-classification later cannot
     tell which rows were judged by which rules. */
  assert.match(BOT_RULES_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/)
})
