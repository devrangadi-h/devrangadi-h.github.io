#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMG_PATH="$ROOT_DIR/images/flower-latest.jpg"
JSON_PATH="$ROOT_DIR/flower-tracker.json"
DEVICE="/dev/video0"  # USB webcam; adjust if needed

# Capture a single frame from the webcam using ffmpeg
ffmpeg -loglevel error -f video4linux2 -i "$DEVICE" -frames:v 1 -q:v 3 -f image2 "$IMG_PATH.tmp" || exit 0
mv "$IMG_PATH.tmp" "$IMG_PATH"

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
