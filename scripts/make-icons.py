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


if __name__ == "__main__":
    main()
