#!/usr/bin/env bash
# One-time setup for the Frames pipeline on the Pi (Debian 13 / Raspberry Pi OS trixie).
# Safe to re-run. Installs system tools and a Python venv OUTSIDE the repo.
set -euo pipefail
VENV=${FRAMES_VENV:-/home/polaris/frames-tools/.venv}

sudo apt-get update -qq
sudo apt-get install -y libimage-exiftool-perl libheif-examples libheif-plugin-libde265 libheif-plugin-x265 \
	rclone ffmpeg python3-venv

mkdir -p "$(dirname "$VENV")"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$(dirname "$0")/requirements.txt"

"$VENV/bin/python" -c "import PIL.features as f, pillow_heif; assert f.check('webp'); print('pillow', f.version('pil'), 'webp', f.version('webp'), 'libheif', pillow_heif.libheif_version())"
exiftool -ver >/dev/null
ffmpeg -hide_banner -encoders 2>/dev/null > /tmp/frames-enc.txt; grep -q libx264 /tmp/frames-enc.txt; rm -f /tmp/frames-enc.txt
echo "frames tools ready ($VENV)"
