"""Sync the media dir to Cloudflare R2 with rclone.

Every media file name carries a content hash, so files are immutable: upload with a one-year
immutable Cache-Control. Upload never deletes; `--prune` (run after the new pages are live)
removes remote files that the current build no longer references.
"""
import shutil
import subprocess
from pathlib import Path

from .build import MANIFEST

DEFAULT_REMOTE = 'frames-r2:frames'
CACHE = 'public, max-age=31536000, immutable'
TYPES = {'.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4'}


def run(cmd, log):
	log('$ ' + ' '.join(f"'{c}'" if ' ' in c or '*' in c else c for c in cmd))
	r = subprocess.run(cmd)
	if r.returncode != 0:
		raise SystemExit(f'rclone failed (exit {r.returncode})')


def upload(media: Path, remote=DEFAULT_REMOTE, dry_run=False, prune=False, log=print):
	if not shutil.which('rclone'):
		raise SystemExit('rclone is not installed (sudo apt-get install -y rclone)')
	if not media.is_dir():
		raise SystemExit(f'{media} does not exist; run build first')
	name = remote.split(':', 1)[0] + ':'
	remotes = subprocess.run(['rclone', 'listremotes'], capture_output=True, text=True).stdout.split()
	if name not in remotes:
		raise SystemExit(f'rclone remote "{name}" is not configured yet (one-time R2 setup, see _tools/frames/README.md)')
	files = [p for p in media.rglob('*') if p.is_file() and p.name != MANIFEST and not p.name.endswith('.tmp')]
	odd = sorted({p.suffix for p in files} - set(TYPES))
	if odd:
		raise SystemExit(f'unexpected file types in {media}: {", ".join(odd)}')
	skip = ['--filter', f'- /{MANIFEST}', '--filter', '- *.tmp']
	common = ['--checksum', '--s3-no-check-bucket', '--stats-one-line', '-v']
	if dry_run:
		common.append('--dry-run')
	log(f'{len(files)} media file(s) in {media}')
	for ext, ctype in TYPES.items():
		if not any(p.suffix == ext for p in files):
			continue
		run(['rclone', 'copy', str(media), remote, *skip, '--filter', f'+ *{ext}', '--filter', '- *',
			'--header-upload', f'Content-Type: {ctype}', '--header-upload', f'Cache-Control: {CACHE}', *common], log)
	if prune:
		run(['rclone', 'sync', str(media), remote, *skip, *common], log)
