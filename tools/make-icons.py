#!/usr/bin/env python3
"""
Generate the AD-Finance PWA icon set + store screenshot.

Mark: deep navy→blue squircle with a bold "AD" monogram, a thin ledger
baseline, and a mint accent dot. Drawn at 4× and downsampled with LANCZOS so
edges stay crisp. Mirrors the in-app logo in src/components/icons.js.
"""
from PIL import Image, ImageDraw, ImageFont
import math, os

FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/local/lib/python3.13/site-packages/matplotlib/mpl-data/fonts/ttf/DejaVuSans-Bold.ttf',
]


def monogram_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, int(px))
    return ImageFont.load_default()

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)

SS = 4                                  # supersample factor
BRAND = [(20, 36, 95), (30, 64, 175), (37, 99, 235)]
MINT = (125, 243, 176)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def gradient(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, (x / size) * 0.55 + (y / size) * 0.5)
            if t < 0.5:
                c = lerp(BRAND[0], BRAND[1], t / 0.5)
            else:
                c = lerp(BRAND[1], BRAND[2], (t - 0.5) / 0.5)
            px[x, y] = tuple(int(v) for v in c)
    return img


def mark_layer(size, scale=1.0):
    """The AD monogram, drawn on its own transparent layer so alpha blends correctly."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    u = size / 48.0 * scale
    ox = (size - 48 * u) / 2
    oy = (size - 48 * u) / 2

    def P(x, y):
        return (ox + x * u, oy + y * u)

    # bold "AD" monogram, optically centred with room for the rule + dot
    font = monogram_font(15.8 * u)
    text = 'AD'
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    width, height = right - left, bottom - top
    tx = ox + (48 * u - width) / 2 - left - 0.3 * u
    ty = oy + (48 * u - height) / 2 - top - 2.2 * u
    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    # ledger baseline under the letters
    rule_w = width * 0.52
    rule_x = ox + (48 * u - rule_w) / 2 + 0.8 * u
    rule_y = oy + 31.2 * u
    draw.rounded_rectangle([rule_x, rule_y, rule_x + rule_w, rule_y + 1.7 * u],
                           radius=0.85 * u, fill=(255, 255, 255, 145))
    # mint accent dot (positive balance)
    r = 2.0 * u
    c = P(36.4, 13.4)
    draw.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=MINT + (255,))
    return layer


def make_icon(size, maskable=False):
    big = size * SS
    base = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    canvas = gradient(big).convert('RGBA')

    if maskable:
        base = canvas                                        # full-bleed background
        base = Image.alpha_composite(base, mark_layer(big, scale=0.62))
    else:
        radius = int(big * 0.235)
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
        base.paste(canvas, (0, 0), mask)
        base = Image.alpha_composite(base, mark_layer(big, scale=1.0))
        # inner highlight ring
        ring = Image.new('RGBA', (big, big), (0, 0, 0, 0))
        rw = max(1, big // 200)
        ImageDraw.Draw(ring).rounded_rectangle([rw, rw, big - 1 - rw, big - 1 - rw], radius=radius,
                                               outline=(255, 255, 255, 46), width=rw)
        base = Image.alpha_composite(base, ring)

    return base.resize((size, size), Image.LANCZOS)


make_icon(512).save(os.path.join(OUT, 'icon-512.png'))
make_icon(192).save(os.path.join(OUT, 'icon-192.png'))
make_icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
make_icon(32).save(os.path.join(OUT, 'favicon-32.png'))
make_icon(512, maskable=True).save(os.path.join(OUT, 'maskable-512.png'))

# ---------------------------------------------------------------- screenshot
W, H = 1280, 720
shot = Image.new('RGB', (W, H), (244, 246, 251))
sd = ImageDraw.Draw(shot, 'RGBA')


def card(x, y, w, h, radius=18, fill=(255, 255, 255, 255), outline=(228, 232, 240, 255)):
    sd.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=outline, width=1)


def bar(x, y, w, h, color, radius=None):
    sd.rounded_rectangle([x, y, x + w, y + h], radius=radius if radius is not None else min(h / 2, 6), fill=color)


def vgradient(size, c0, c1):
    img = Image.new('RGB', size)
    px = img.load()
    for y in range(size[1]):
        for x in range(size[0]):
            t = min(1.0, (x / size[0]) * 0.45 + (y / size[1]) * 0.6)
            px[x, y] = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    return img

# ---- floating rounded sidebar ----
card(12, 12, 236, H - 24, radius=24)
logo = make_icon(38)
shot.paste(logo, (30, 28), logo)
sd.text((78, 32), 'AD-Finance', font=monogram_font(16), fill=(15, 23, 42))
bar(78, 54, 96, 7, (148, 163, 184, 200), radius=3)
for i in range(7):
    y = 92 + i * 40
    if i == 0:
        sd.rounded_rectangle([24, y, 236, y + 36], radius=13, fill=(35, 88, 220, 255))
        sd.rounded_rectangle([38, y + 11, 52, y + 25], radius=5, fill=(255, 255, 255, 235))
        bar(60, y + 13, 104, 10, (255, 255, 255, 235), radius=5)
    else:
        sd.rounded_rectangle([38, y + 11, 52, y + 25], radius=5, fill=(203, 213, 225, 255))
        bar(60, y + 13, 118 if i % 2 == 0 else 96, 10, (203, 213, 225, 255), radius=5)
# net worth chip
chip = vgradient((212, 108), (22, 38, 92), (37, 99, 235))
cmask = Image.new('L', (212, 108), 0)
ImageDraw.Draw(cmask).rounded_rectangle([0, 0, 211, 107], radius=18, fill=255)
shot.paste(chip, (24, H - 156), cmask)
sd.text((40, H - 142), 'NET WORTH', font=monogram_font(9), fill=(255, 255, 255, 170))
sd.text((40, H - 124), 'Rp 19.731.000', font=monogram_font(16), fill=(255, 255, 255))
sd.ellipse([212, H - 142, 222, H - 132], fill=(125, 243, 176, 255))
sd.rounded_rectangle([38, H - 96, 222, H - 62], radius=11, fill=(255, 255, 255, 40))
sd.text((92, H - 87), '+  Transaksi baru', font=monogram_font(11), fill=(255, 255, 255))

# ---- rounded header island ----
card(270, 12, W - 282, 58, radius=20)
sd.text((292, 24), 'RINGKASAN KEUANGAN', font=monogram_font(8), fill=(148, 163, 184))
sd.text((292, 36), 'Dashboard', font=monogram_font(16), fill=(15, 23, 42))
sd.rounded_rectangle([W - 316, 24, W - 190, 58], radius=99, fill=(244, 246, 251, 255))
sd.text((W - 302, 35), 'Cari', font=monogram_font(11), fill=(100, 116, 139))
sd.rounded_rectangle([W - 134, 22, W - 30, 60], radius=99, fill=(244, 246, 251, 255))
sd.ellipse([W - 96, 32, W - 84, 44], fill=(18, 143, 90, 255))
sd.text((W - 128, 34), 'Online', font=monogram_font(9), fill=(18, 143, 90))
sd.ellipse([W - 56, 25, W - 22, 59], fill=(35, 88, 220, 255))
sd.text((W - 39, 42), 'AD', font=monogram_font(10), fill=(255, 255, 255), anchor='mm')

# ---- ATM hero card ----
CX, CY, CW = 270, 92, 630
CH = int(CW / 1.62)
hero = vgradient((CW, CH), (11, 22, 51), (37, 99, 235))
hmask = Image.new('L', (CW, CH), 0)
ImageDraw.Draw(hmask).rounded_rectangle([0, 0, CW - 1, CH - 1], radius=24, fill=255)
shot.paste(hero, (CX, CY), hmask)
hd = ImageDraw.Draw(shot, 'RGBA')
mini = make_icon(30)
shot.paste(mini, (CX + 22, CY + 20), mini)
hd.text((CX + 60, CY + 22), 'AD-Finance', font=monogram_font(14), fill=(255, 255, 255))
hd.text((CX + 60, CY + 41), 'DIGITAL WALLET & LEDGER', font=monogram_font(7), fill=(255, 255, 255, 165))
for r in (7, 11, 15, 19):
    hd.arc([CX + CW - 46 - r, CY + 30 - r, CX + CW - 46 + r, CY + 30 + r], -55, 55,
           fill=(255, 255, 255, 180), width=2)
hd.rounded_rectangle([CX + 22, CY + 84, CX + 62, CY + 114], radius=6,
                     fill=(232, 205, 140, 255), outline=(255, 255, 255, 90))
hd.rectangle([CX + 38, CY + 84, CX + 46, CY + 114], outline=(120, 92, 40, 255))
hd.text((CX + 78, CY + 92), '••••  ••••  ••••  8778', font=monogram_font(13), fill=(255, 255, 255, 235))
hd.text((CX + 22, CY + 132), 'TOTAL SALDO', font=monogram_font(9), fill=(255, 255, 255, 155))
hd.text((CX + 22, CY + 150), 'Rp 61.175.000', font=monogram_font(32), fill=(255, 255, 255))
hd.rounded_rectangle([CX + 22, CY + 196, CX + 170, CY + 218], radius=99,
                     fill=(52, 211, 153, 60), outline=(52, 211, 153, 110))
hd.text((CX + 40, CY + 201), '▲  +4,2%  ·  30 hari', font=monogram_font(10), fill=(214, 251, 234))
fy = CY + CH - 48
hd.text((CX + 22, fy), 'CARD HOLDER', font=monogram_font(7), fill=(255, 255, 255, 145))
hd.text((CX + 22, fy + 12), 'DIAN AYU PRAMESTI', font=monogram_font(12), fill=(255, 255, 255))
hd.text((CX + CW - 152, fy), 'MEMBER SINCE', font=monogram_font(7), fill=(255, 255, 255, 145))
hd.text((CX + CW - 152, fy + 12), '2026', font=monogram_font(12), fill=(255, 255, 255))
hd.text((CX + CW - 76, fy), 'NET WORTH', font=monogram_font(7), fill=(255, 255, 255, 145))
hd.text((CX + CW - 76, fy + 12), 'Rp 19,7 jt', font=monogram_font(12), fill=(255, 255, 255))

# ---- stats strip + net worth card beside the hero ----
sy = CY + CH + 24
for i, (lab, val, col) in enumerate([('PEMASUKAN', '+Rp 12,4 jt', (18, 143, 90, 255)),
                                     ('PENGELUARAN', '−Rp 8,1 jt', (217, 45, 63, 255)),
                                     ('CASH FLOW', 'Rp 4,3 jt', (18, 143, 90, 255)),
                                     ('PERIODE', 'September 2026', (15, 23, 42, 255))]):
    x = CX + (i % 2) * 320
    y = sy + (i // 2) * 44
    sd.text((x, y), lab, font=monogram_font(8), fill=(148, 163, 184))
    sd.text((x, y + 12), val, font=monogram_font(15), fill=col)

card(920, 92, W - 932, CH, radius=22)
sd.text((944, 116), 'Kekayaan Bersih', font=monogram_font(14), fill=(15, 23, 42))
bar(944, 140, 190, 13, (15, 23, 42, 210), radius=5)
sd.text((944, 162), 'Aset − Liabilitas · 6 bulan', font=monogram_font(9), fill=(148, 163, 184))
pts = [(950 + i * 33, 300 - int(38 * abs(math.sin(i / 8 * math.pi)) ** 1.3) - i * 4) for i in range(10)]
for a, b in zip(pts, pts[1:]):
    sd.line([a, b], fill=(37, 99, 235, 220), width=3)
for i in range(5):
    y = 340 + i * 22
    sd.ellipse([950, y + 4, 960, y + 14], fill=(37, 99, 235, 200))
    bar(970, y + 7, 96 - i * 8, 8, (203, 213, 225, 255), radius=4)
    bar(1130, y + 7, 62, 8, (15, 23, 42, 190), radius=4)

# ---- bottom chart row ----
card(920, 92 + CH + 24, W - 932, H - (92 + CH + 48), radius=22)
sd.text((944, 92 + CH + 44), 'Arus Kas', font=monogram_font(13), fill=(15, 23, 42))
base = H - 44
for i in range(7):
    x = 948 + i * 42
    h1 = 26 + int(46 * abs(math.sin(i * 1.05)))
    h2 = 16 + int(32 * abs(math.cos(i * 0.92)))
    sd.rounded_rectangle([x, base - h1, x + 14, base], radius=4, fill=(34, 197, 94, 215))
    sd.rounded_rectangle([x + 17, base - h2, x + 31, base], radius=4, fill=(239, 68, 68, 215))
sd.line([944, base, W - 24, base], fill=(226, 232, 240, 255), width=1)

shot.save(os.path.join(OUT, 'screenshot-wide.png'))

# ---------------------------------------------------------------- svg icon
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="512" height="512" role="img" aria-label="AD-Finance">
  <defs>
    <linearGradient id="adBg" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
      <stop stop-color="#14245F"/><stop offset="0.5" stop-color="#1E40AF"/><stop offset="1" stop-color="#2563EB"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="48" height="48" rx="11.3" fill="url(#adBg)"/>
  <rect x="0.5" y="0.5" width="47" height="47" rx="10.8" fill="none" stroke="rgba(255,255,255,.22)"/>
  <text x="23.7" y="28.6" text-anchor="middle" font-family="DejaVu Sans, Verdana, Segoe UI, system-ui, sans-serif"
        font-size="15.8" font-weight="700" letter-spacing="-0.5" fill="#FFFFFF">AD</text>
  <rect x="18.1" y="31.2" width="11.6" height="1.55" rx="0.85" fill="rgba(255,255,255,.57)"/>
  <circle cx="36.4" cy="13.4" r="2" fill="#7DF3B0"/>
</svg>
'''
for name in ('icon.svg', 'favicon.svg'):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as fh:
        fh.write(svg)

print('icons + screenshot written to', os.path.abspath(OUT))
for name in sorted(os.listdir(OUT)):
    print(f'  - {name:24s} {os.path.getsize(os.path.join(OUT, name)):>8,} bytes')
