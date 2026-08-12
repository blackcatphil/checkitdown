/**
 * ONE BIT INSTEAD OF A USER-AGENT.
 *
 * The raw UA string is not stored — it is a fingerprinting input and a
 * free-text column nobody reads. What the product needs is whether the hit was
 * automated, so that is decided here, at write time, and only the answer is
 * kept.
 *
 * ⚠️ THE VERSION IS STORED WITH THE ANSWER, and that is the part that makes the
 * filter falsifiable. Without it, "we excluded bots" is a claim about rows
 * judged by rules nobody can reconstruct — and when the rules change, old and
 * new judgements become indistinguishable in the same table. With it, a count
 * can say which classifier it trusted.
 *
 * BUMP THE VERSION WHENEVER THE RULES BELOW CHANGE. That is the whole contract.
 */
export const BOT_RULES_VERSION = '2026-08-11.1'

/**
 * Substrings that appear in the UA of things that are not people.
 *
 * Deliberately a SUBSTRING LIST rather than anything clever. A heuristic that
 * scores "botness" from timing or entropy is a heuristic that silently
 * reclassifies real readers, and there is no ground truth here to tune against
 * — nobody can go back and ask a row whether it was a person.
 *
 * `headless` catches automated Chrome, including this repo's own probes, which
 * is the behaviour we want: a CI run must not look like traffic.
 */
const SIGNATURES = [
  'bot', 'crawler', 'spider', 'crawl',
  'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'curl/', 'wget', 'python-requests', 'python-urllib', 'go-http-client',
  'java/', 'okhttp', 'axios/', 'node-fetch', 'got/', 'libwww',
  'slackbot', 'discordbot', 'twitterbot', 'facebookexternalhit', 'whatsapp',
  'telegrambot', 'linkedinbot', 'redditbot', 'pinterest', 'embedly',
  'lighthouse', 'pagespeed', 'gtmetrix', 'pingdom', 'uptimerobot',
  'preview', 'validator', 'monitoring', 'archiver', 'feedfetcher',
]

/**
 * True when the user-agent looks automated.
 *
 * AN ABSENT UA COUNTS AS A BOT. Every real browser sends one; a request without
 * it is a script that did not bother, and treating "unknown" as "person" is the
 * direction that inflates the numbers we would act on.
 */
export function isBot(userAgent: string | null | undefined): boolean {
  if (userAgent == null) return true
  const ua = userAgent.trim().toLowerCase()
  if (ua === '') return true
  return SIGNATURES.some((s) => ua.includes(s))
}
