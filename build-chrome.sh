#!/usr/bin/env bash
# Builds the Chrome (MV3) extension into dist/chrome/ from the shared source in
# firefox-extension/ — the `browser`/`chrome` shim in the JS makes it cross-browser,
# so the only Chrome-specific pieces are the MV3 manifest (chrome/manifest.json) and
# the PNG icons (Chrome doesn't accept SVG manifest icons; Firefox does).
#
# Usage: bash build-chrome.sh   →   load dist/chrome/ unpacked at chrome://extensions
set -euo pipefail
cd "$(dirname "$0")"

SRC=firefox-extension
OUT=dist/chrome
rm -rf "$OUT"; mkdir -p "$OUT"

# Shared, hand-written source — identical to the Firefox build.
cp "$SRC/background.js" "$SRC/dropviewer.js" "$SRC/viewer.js" "$SRC/viewer.html" "$OUT/"
cp chrome/manifest.json "$OUT/manifest.json"

# Rasterize the droplet to PNGs (QuickLook renders the SVG, sips downscales).
qlmanage -t -s 512 -o "$OUT" "$SRC/icon.svg" >/dev/null 2>&1
mv "$OUT/icon.svg.png" "$OUT/_icon.png"
for s in 16 48 128; do sips -z "$s" "$s" "$OUT/_icon.png" --out "$OUT/icon-$s.png" >/dev/null; done
rm "$OUT/_icon.png"

echo "Built $OUT"
ls -1 "$OUT"
