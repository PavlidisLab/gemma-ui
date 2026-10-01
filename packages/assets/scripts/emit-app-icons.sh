#!/usr/bin/env bash
# Emit an app's home-screen icon rasters (and its favicon.ico) from the
# shared Gemma mark.
#
# Node has no SVG renderer, which is why emit-favicon.mjs stops at SVG and
# this is a shell script: the raster step needs rsvg-convert, a system
# binary. Everything here is generated — the only hand-authored artwork is
# packages/assets/src/images/logo/gemma-mark.svg.
#
# What it writes into <app>/public/:
#
#   apple-touch-icon.png   180  iOS home screen. iOS ignores an SVG favicon
#                               for the home screen and falls back to the
#                               32px .ico, upscaled — which is what a
#                               low-resolution home-screen icon means.
#   icon-192.png           192  Android / manifest.
#   icon-512.png           512  Android / manifest, splash.
#   favicon.ico            multi-size raster (16/32/48) for clients that
#                               cannot render an SVG icon.
#
# Usage: emit-app-icons.sh <app-dir>        e.g. apps/browser
set -euo pipefail

app_dir=${1:-}
if [ -z "$app_dir" ]; then
    echo "usage: emit-app-icons.sh <app-dir>   (e.g. apps/browser)" >&2
    exit 2
fi
pub="$app_dir/public"
[ -d "$pub" ] || { echo "no such directory: $pub" >&2; exit 1; }

for tool in rsvg-convert python3; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "ERROR: $tool not on PATH (brew install librsvg)" >&2; exit 1; }
done
python3 -c 'import PIL' 2>/dev/null || {
    echo "ERROR: Pillow not importable (pip3 install Pillow)" >&2; exit 1; }

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The opaque, wider-margin cut. See buildAppIconSvg for why a home-screen
# tile is not the favicon scaled up.
node "$here/emit-favicon.mjs" --variant app-icon --out "$tmp/app-icon.svg" >/dev/null

for spec in "apple-touch-icon.png:180" "icon-192.png:192" "icon-512.png:512"; do
    name=${spec%%:*}; px=${spec##*:}
    rsvg-convert -w "$px" -h "$px" "$tmp/app-icon.svg" -o "$pub/$name"
    echo "emit-app-icons: wrote $pub/$name (${px}x${px})"
done

# Android may mask a `purpose: maskable` icon to a circle, and the manifest
# declares ours as one. The contract is that no ink falls outside a centred
# circle of 80% diameter. That depends on the MARK's own silhouette, not just
# the margin — a mark that clears the margin check can still lose its edges —
# so it is measured on the rendered raster, here, where a change to the
# artwork is what would break it.
python3 - "$pub/icon-512.png" <<'MASKCHECK'
import math, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); w, h = im.size; px = im.load()
cx, cy, far = w / 2, h / 2, 0.0
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if not (r > 247 and g > 247 and b > 247):
            far = max(far, math.hypot(x + 0.5 - cx, y + 0.5 - cy))
pct, safe = 200 * far / w, 80.0
print(f"emit-app-icons: maskable safe zone {pct:.1f}% of {safe:.0f}% used")
if pct > safe:
    sys.exit(
        f"ERROR: ink reaches {pct:.1f}% diameter, outside the {safe:.0f}% "
        "maskable safe zone - a circular mask would clip it. Either widen "
        "ICON_MARGIN_RATIO in emit-favicon.mjs or drop the maskable purpose "
        "from the manifest."
    )
MASKCHECK

# favicon.ico comes from the FAVICON cut, not the app-icon cut: it keeps the
# tight margin and the transparent ground a tab strip wants.
if [ -f "$pub/favicon.svg" ]; then
    rsvg-convert -w 48 -h 48 "$pub/favicon.svg" -o "$tmp/fav48.png"
    python3 - "$tmp/fav48.png" "$pub/favicon.ico" <<'PY'
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
Image.open(src).convert("RGBA").save(dst, format="ICO",
                                     sizes=[(16, 16), (32, 32), (48, 48)])
PY
    echo "emit-app-icons: wrote $pub/favicon.ico (16/32/48)"
fi
