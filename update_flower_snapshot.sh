#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMG_PATH="$ROOT_DIR/images/flower-latest.jpg"
JSON_PATH="$ROOT_DIR/flower-tracker.json"
DEVICE="/dev/video0"  # USB webcam; adjust if needed

# Capture a single frame from the webcam using ffmpeg
rm -f "$IMG_PATH.tmp"
ffmpeg -y -loglevel error -f video4linux2 -i "$DEVICE" -frames:v 1 -q:v 3 -f image2 "$IMG_PATH.tmp" || exit 0

# Post-process exposure using Pillow to avoid blown-out highlights
python3 - << 'EOF'
import os
from PIL import Image, ImageOps

root = os.path.dirname(os.path.abspath(__file__))
img_path_tmp = os.path.join(root, "images", "flower-latest.jpg.tmp")
img_path = os.path.join(root, "images", "flower-latest.jpg")

try:
    img = Image.open(img_path_tmp).convert("RGB")
    # Mild exposure correction: small auto-contrast only
    img = ImageOps.autocontrast(img, cutoff=2)
    img.save(img_path, optimize=True, quality=90)
except Exception:
    # Fall back to the raw capture if processing fails
    import shutil
    if os.path.exists(img_path_tmp):
        shutil.move(img_path_tmp, img_path)
else:
    if os.path.exists(img_path_tmp):
        os.remove(img_path_tmp)

EOF

# Write/update a tiny JSON with last update time
python3 - << 'EOF'
import json, os
from datetime import datetime, timezone

root = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(root, "flower-tracker.json")
now = datetime.now(timezone.utc).astimezone()

payload = {
    "lastUpdated": now.isoformat(timespec="seconds"),
    "image": "images/flower-latest.jpg",
}

tmp = json_path + ".tmp"
with open(tmp, "w") as f:
    json.dump(payload, f, indent=2)
os.replace(tmp, json_path)
EOF

cd "$ROOT_DIR"

# Only commit if something actually changed
if git diff --quiet -- flower-tracker.json images/flower-latest.jpg; then
  exit 0
fi

git add flower-tracker.json images/flower-latest.jpg
GIT_COMMITTER_NAME="Polaris" GIT_COMMITTER_EMAIL="polaris@local" \
  git commit -m "Update flower tracker snapshot (auto)" --author="Polaris <polaris@local>" || exit 0
git push origin main || true
