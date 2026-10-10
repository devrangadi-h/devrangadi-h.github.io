#!/home/polaris/frames-tools/.venv/bin/python
"""Frames publishing pipeline. Run from the site repo root:

	_tools/frames/frames.py validate|build|upload|publish [options]
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from framespipe import build as b  # noqa: E402
from framespipe import upload as up  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
DEFAULT_INBOX = Path('/home/polaris/frames-inbox')
LIVE_BASE = 'https://frames.devrobotics.dev'


def main(argv=None):
	ap = argparse.ArgumentParser(prog='frames', description='Frames publishing pipeline')
	sub = ap.add_subparsers(dest='cmd', required=True)
	v = sub.add_parser('validate', help='check every Inbox folder and report all problems')
	v.add_argument('--inbox', type=Path, default=DEFAULT_INBOX)
	for name in ('build', 'publish'):
		p = sub.add_parser(name, help='validate, process media, write frames.json, frames.html grid and story pages' if name == 'build' else f'build --media-base {LIVE_BASE}, then upload')
		p.add_argument('--inbox', type=Path, default=DEFAULT_INBOX)
		p.add_argument('--out-media', type=Path, default=Path('_media/frames'), help='media dir (relative to --repo)')
		p.add_argument('--repo', type=Path, default=REPO, help='site worktree to write into (default: this repo)')
		p.add_argument('--jobs', type=int, default=3)
		if name == 'build':
			p.add_argument('--media-base', default='/_media/frames')
		else:
			p.add_argument('--remote', default=up.DEFAULT_REMOTE)
			p.add_argument('--dry-run', action='store_true', help='build for real, but only show what upload would do')
	u = sub.add_parser('upload', help='sync the media dir to Cloudflare R2 (never deletes unless --prune)')
	u.add_argument('--out-media', type=Path, default=Path('_media/frames'))
	u.add_argument('--repo', type=Path, default=REPO)
	u.add_argument('--remote', default=up.DEFAULT_REMOTE, help='rclone remote:bucket (default frames-r2:frames)')
	u.add_argument('--dry-run', action='store_true')
	u.add_argument('--prune', action='store_true', help='also delete remote files no longer in the media dir (run after the push is live)')
	a = ap.parse_args(argv)

	if a.cmd == 'validate':
		inbox, _, _ = b.validate(a.inbox)
		b.print_problems(inbox)
		return 1 if inbox.errors else 0
	media = a.out_media if a.out_media.is_absolute() else a.repo / a.out_media
	if a.cmd == 'build':
		b.build(a.repo, a.inbox, a.media_base, media, jobs_n=a.jobs)
		return 0
	if a.cmd == 'upload':
		up.upload(media, a.remote, a.dry_run, a.prune)
		return 0
	if a.cmd == 'publish':
		up_check = up.DEFAULT_REMOTE if a.remote is None else a.remote
		b.build(a.repo, a.inbox, LIVE_BASE, media, jobs_n=a.jobs)
		up.upload(media, up_check, a.dry_run)
		return 0


if __name__ == '__main__':
	sys.exit(main())
