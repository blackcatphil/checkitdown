import Link from 'next/link'

import { INSTALL_PATH } from '@/lib/install'

/**
 * ONE LINK. THAT IS THE WHOLE ENTRY POINT, AND IT IS DELIBERATE.
 *
 * Ruled 2026-08-11. The site became installable four days before anything said
 * so, and the obvious fix for "nobody knows" is the one every other site
 * reaches for: a banner on the map, an interstitial on the second visit, a
 * toast that slides up while you are reading a rake figure. All of them work,
 * in the sense that more people would tap them. All of them also spend the
 * reader's attention on our own distribution at the exact moment they came here
 * to answer a question — on a product whose entire pitch is that it does not
 * waste your time.
 *
 * So: a footer link, findable by anyone looking for it, invisible to anyone who
 * is not. If a prompt on the map ever earns its place it appears ONCE, after
 * somebody has actually used the thing, and never again once dismissed — but
 * that is a later decision with its own evidence, and this is not it.
 *
 * IT CARRIES THE BOTTOM CLEARANCE for the whole app on a phone. The footer is
 * now the last element of every page, so it — and nothing else — is what has to
 * end above the fixed nav. See the note in globals.css.
 */
export function SiteFooter() {
  return (
    <footer className="cid-sitefoot">
      <div className="cid-page">
        <Link href={INSTALL_PATH} className="cid-foot-link">INSTALL ON YOUR PHONE</Link>
      </div>
    </footer>
  )
}
