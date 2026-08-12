"""
THE APP ICON — the mark that ends up on a home screen.

Kept as a script rather than as four opaque PNGs, because an icon nobody can
regenerate is an icon that quietly stays wrong: the set this replaced was still
AUBERGINE five days after the palette was retired, on the one asset a person
actually keeps. Re-run this and the icons follow the tokens.

  python3 scripts/make-icons.py          # writes public/*.png

THE COLOURS COME FROM THE TOKEN FILE, not from a hex pasted here — the same
reasoning the manifest already follows. --cid-accent-500 is commented "mark
solid" and --cid-gold-500 is commented "mark rings, header hairline", so the
mark is blue with a gold rim by the palette law rather than by taste.

WHY A FILLED DISC. It was measured at the size these are seen: masked to a
squircle on iOS and a circle on Android at 64, 40 and 28px. A ring loses its
gold hairline by 40px and reads as a dark blob by 28px; a filled disc still
reads as a blue mark with a warm rim. Phil chose it against four alternatives.

THE MASKABLE ONE IS DRAWN SMALLER ON PURPOSE. Android crops a maskable icon to
whatever shape the launcher uses, guaranteeing only a centred circle of 80% of
the canvas — the "safe zone". The standard icon fills more than that, so a
single file used for both would have its rim shaved off on a circular launcher.
"""
import re
import pathlib
from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "app" / "styles" / "tokens" / "colors.css"
FONT = ROOT / "scripts" / "assets" / "IBMPlexMono-SemiBold.ttf"
OUT = ROOT / "public"
APP = ROOT / "app"        # Next serves app/icon.png and app/favicon.ico by convention

S = 1024  # drawn large and downsampled, so every size is antialiased


def token(name: str) -> tuple:
    """Read a hex token out of colors.css. A pasted hex would survive the next
    palette change exactly the way the aubergine icons did."""
    css = TOKENS.read_text(encoding="utf-8")
    m = re.search(rf"--{name}:\s*(#[0-9A-Fa-f]{{6}})", css)
    if not m:
        raise SystemExit(f"token --{name} not found in {TOKENS}")
    h = m.group(1).lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


INK = token("cid-ink-800")        # the page; the splash screen should look like the app arriving
BLUE = token("cid-accent-500")    # "mark solid"
GOLD = token("cid-gold-500")      # "mark rings, header hairline"


def mark(disc: float, band: float, letter: float) -> Image.Image:
    im = Image.new("RGB", (S, S), INK)
    d = ImageDraw.Draw(im)
    c, r = S // 2, int(S * disc)
    d.ellipse([c - r, c - r, c + r, c + r], fill=BLUE)
    d.ellipse([c - r, c - r, c + r, c + r], outline=GOLD, width=int(S * band))

    f = ImageFont.truetype(str(FONT), int(S * letter))
    track = int(S * 0.018)  # the product letterspaces its mono labels; so does the mark
    widths = [d.textlength(ch, font=f) for ch in "CID"]
    bb = d.textbbox((0, 0), "CID", font=f)
    x = (S - (sum(widths) + track * 2)) / 2
    y = (S - (bb[3] - bb[1])) / 2 - bb[1]
    for ch, w in zip("CID", widths):
        d.text((x, y), ch, font=f, fill=INK)  # knocked out to the page, not painted on
        x += w + track
    return im


def small_mark(disc_f: float = 0.42, band_f: float = 0.042,
               letter_f: float = 0.50) -> Image.Image:
    """THE SMALL-SIZE VARIANT — one letter, because three cannot be drawn.

    MEASURED 2026-08-11, at the master and scaled down. The stroke of IBM Plex
    Mono SemiBold is 38px at the 1024 master when the letter box is 0.29 of the
    canvas, and the three letters are then:

        16px favicon  ->  0.59px stroke   three grey blobs, unreadable
        20px          ->  0.74px          still mush
        24px          ->  0.89px          still mush
        28px          ->  1.04px          soft, one pixel with no headroom
        32px          ->  1.19px          soft; readable if you know it
        48px          ->  1.78px          reads cleanly

    So the letters are SUB-PIXEL below 28px. That is not a rendering problem to
    tune, it is arithmetic: getting a 1.5px stroke at 16px needs ~96px of stroke
    at the master, which at this face's stroke-to-cap ratio needs a cap of about
    530px — and three monospaced letters at that cap are some 1,200px wide
    against a disc only 860px across. THREE LETTERS AT 16px DO NOT FIT. No
    weight, tracking or hinting recovers it.

    One letter does: at 0.50 of the canvas the C's bowl is 71px at the master,
    which is 1.11px at 16px and 2.22px at 32px — a stroke a browser can actually
    put down. The rim is thickened from 0.030 to 0.042 for the same reason: at
    16px the standard rim is a single antialiased pixel that breaks up around
    the top of the circle.

    The silhouette is unchanged, so a tab and a home screen read as the same
    object. What is dropped is the two letters that were never legible there.
    """
    im = Image.new("RGB", (S, S), INK)
    d = ImageDraw.Draw(im)
    c, r = S // 2, int(S * disc_f)
    d.ellipse([c - r, c - r, c + r, c + r], fill=BLUE)
    d.ellipse([c - r, c - r, c + r, c + r], outline=GOLD, width=int(S * band_f))
    f = ImageFont.truetype(str(FONT), int(S * letter_f))
    bb = d.textbbox((0, 0), "C", font=f)
    d.text(((S - (bb[2] - bb[0])) / 2 - bb[0], (S - (bb[3] - bb[1])) / 2 - bb[1]),
           "C", font=f, fill=INK)
    return im


def main() -> None:
    standard = mark(0.42, 0.030, 0.29)
    # 0.355 keeps the whole rim inside Android's 80% safe circle.
    maskable = mark(0.355, 0.026, 0.245)

    for img, size, name in (
        (standard, 512, "icon-512.png"),
        (standard, 192, "icon-192.png"),
        (standard, 180, "apple-touch-icon.png"),  # iOS ignores the manifest for this
        (maskable, 512, "icon-maskable-512.png"),
    ):
        img.resize((size, size), Image.LANCZOS).save(OUT / name)
        print(f"  wrote public/{name} ({size}px)")

    # ── THE HEADER MARK ───────────────────────────────────────────────────
    # 64px for a 32px slot, so it is crisp on a 2x display and downsamples
    # cleanly on a 1x one. The FULL mark: at a 32px slot the letters are soft
    # but the wordmark is right beside them, so the mark is carrying identity
    # rather than text. Generated here so the header cannot drift from the
    # icons — the alternative was a hand-drawn SVG that would.
    standard.resize((64, 64), Image.LANCZOS).save(OUT / "mark-64.png")
    print("  wrote public/mark-64.png (64px, the header lockup)")

    # ── THE BROWSER TAB ───────────────────────────────────────────────────
    # ⚠️ app/favicon.ico WAS THE NEXT.JS DEFAULT — a black disc with a white
    # triangle, Vercel's mark, served as this site's identity in every tab
    # since launch. Next gives that file precedence over app/icon.png, so
    # adding an icon without replacing this one would have changed nothing.
    small = small_mark()
    small.resize((32, 32), Image.LANCZOS).save(APP / "icon.png")
    print("  wrote app/icon.png (32px, the small-size variant)")

    # THE .ico IS KEPT, and not for IE11. `/favicon.ico` is still requested
    # unconditionally — by link unfurlers, feed readers and browsers that ask
    # before parsing <head> — and the file already existed, so the choice was
    # never "add one or not" but "replace the Next default or leave it".
    # Multi-size, because an .ico holding only 32 gets downsampled by the
    # client at 16 and we can do that better here.
    # ⚠️ RGBA, NOT RGB. Pillow will happily write an .ico whose sub-images are
    # RGB PNGs, and Next's image decoder refuses it outright — "Format error
    # decoding Ico: The PNG is not in RGBA format" — which fails the BUILD, not
    # just the icon. Everything else here is deliberately opaque RGB, so this is
    # the one conversion in the file and it is not optional.
    small.convert("RGBA").resize((48, 48), Image.LANCZOS).save(
        APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("  wrote app/favicon.ico (16/32/48, replacing the Next default)")


if __name__ == "__main__":
    main()
