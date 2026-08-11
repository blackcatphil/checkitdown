import { INSTALL_URL } from './install.ts'
import { qrMatrix } from './qr.ts'
import { readServerToken } from './tokens-server.ts'

/**
 * THE INSTALL QR, BUILT ONCE AND MEASURED ONCE.
 *
 * SERVER ONLY. `lib/install.ts` is imported by client components, so the
 * encoder deliberately does not live there — a QR generator has no business in
 * a phone's JavaScript bundle to draw an image the server already has. What
 * crosses to the client is one number: how many modules wide the symbol is.
 *
 * THAT NUMBER IS WHY THIS FILE EXISTS. The CSS has to size the image to a whole
 * number of pixels per module, which means the stylesheet needs the module
 * count — and a `37px` typed into globals.css would be a copy of a fact derived
 * from the URL's length. Change the domain, or the path, and the symbol grows
 * to version 4: 33 modules instead of 29, and the CSS would still be rounding
 * to a 37-module grid it no longer has. Silent, and it degrades exactly the
 * thing the symbol exists for. So the count travels as a custom property that
 * the page sets from this value.
 */

/** Modules of clear space on every side. Four is the specified minimum; below
 *  it a scanner cannot separate the symbol from what it is printed on. */
export const QR_QUIET_ZONE = 4

/* Computed at module load: the URL is a constant, so the symbol is too. */
const MATRIX = qrMatrix(INSTALL_URL, { ecc: 'Q' })

/** The symbol's width in modules INCLUDING the quiet zone — the grid the
 *  rendered image has to be an exact multiple of. */
export const QR_MODULES = MATRIX.length + QR_QUIET_ZONE * 2

export function installQrSvg(): string {
  const n = MATRIX.length
  const side = QR_MODULES

  /* Horizontal runs rather than one rect per module: a third of the nodes, and
     no hairline seam where two rects meet at a shared edge. */
  const runs: string[] = []
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!MATRIX[r][c]) { c++; continue }
      let len = 0
      while (c + len < n && MATRIX[r][c + len]) len++
      runs.push(`<rect x="${c + QR_QUIET_ZONE}" y="${r + QR_QUIET_ZONE}" width="${len}" height="1"/>`)
      c += len
    }
  }

  /* THE COLOURS COME FROM THE TOKENS, and the polarity is not negotiable: dark
     modules on a light ground. Most scanners handle an inverted symbol; not all
     do, and "most" is the wrong standard for the one image whose whole job is
     to be read by a stranger's phone in a hurry. So the symbol sits on a paper
     card rather than on the app's own dark page. */
  const ink = readServerToken('--cid-ink-800')
  const paper = readServerToken('--cid-paper')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"`
    + ` width="${side * 8}" height="${side * 8}" shape-rendering="crispEdges"`
    + ` role="img" aria-label="QR code for ${INSTALL_URL}">`
    + `<title>QR code for ${INSTALL_URL}</title>`
    + `<rect width="${side}" height="${side}" fill="${paper}"/>`
    + `<g fill="${ink}">${runs.join('')}</g>`
    + '</svg>'
}
