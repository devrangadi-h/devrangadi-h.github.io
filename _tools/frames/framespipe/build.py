"""validate + build: Inbox -> media dir, frames.json, frames.html grid, frames/<slug>.html."""
import datetime as dt
import hashlib
import json
import math
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import clips, images, render, shot
from .inbox import CLIP_EXT, IMAGE_EXT, Inbox, load_inbox, parse_focus, parse_md_date, stem_slug
from .md import MdError, render as md_render

PIPELINE_VERSION = 1  # bump to force every output to be regenerated (and renamed)
MANIFEST = '.manifest.json'
WPM = 220


@dataclass
class Job:
	key: str  # media folder, e.g. "kyoto-rain" or "arashiyama/bamboo"
	src: Path
	kind: str  # jpeg | heic | clip
	focus: tuple = (0.5, 0.5)
	row: dict = field(default_factory=dict)


# --- validation -------------------------------------------------------------

def validate(inbox_dir: Path):
	"""Returns (inbox, exif rows, probes). All problems are in inbox.problems."""
	inbox = load_inbox(inbox_dir)
	img_paths, clip_paths = [], []
	for p in inbox.photos:
		if p.image:
			img_paths.append(p.image)
	for s in inbox.stories:
		for name, path in s.files.items():
			(clip_paths if path.suffix.lower() in CLIP_EXT else img_paths).append(path)
	rows = shot.read_all(img_paths + clip_paths)
	probes = {}
	for path in img_paths:
		try:
			kind, w, h = images.probe(path)
			if kind == 'heic' and path.suffix.lower() not in ('.heic', '.heif'):
				inbox.warn(path, None, 'this is a HEIC file with a JPEG extension; it is processed as HEIC')
			if kind == 'jpeg' and path.suffix.lower() not in ('.jpg', '.jpeg'):
				inbox.warn(path, None, 'this is a JPEG file with a HEIC extension; it is processed as JPEG')
			probes[path] = (kind, w, h)
		except Exception as e:  # noqa: BLE001 - report any decoder failure
			inbox.error(path, None, f'cannot read image: {e}')
	for path in clip_paths:
		try:
			info = clips.probe(path)
			if info['duration'] > clips.MAX_SECONDS:
				inbox.error(path, None, f'clip is {info["duration"]:.1f} s long; clips must be 10 s or shorter (trim it first)')
			probes[path] = ('clip', info['width'], info['height'])
		except Exception as e:  # noqa: BLE001
			inbox.error(path, None, f'cannot read clip: {e}')
	for p in inbox.photos:
		if p.image and p.image in probes and 'date' not in p.meta.fields and not shot.taken_iso(rows.get(p.image, {})):
			inbox.error(p.md, None, f'{p.image.name} has no date taken in its metadata; add "date: YYYY-MM-DD" to the header')
	for s in inbox.stories:
		cover = s.files.get(s.meta.fields.get('cover', ''))
		if cover and cover in probes and 'date' not in s.meta.fields and not shot.taken_iso(rows.get(cover, {})):
			inbox.error(s.md, s.meta.lines.get('cover'), f'the cover {cover.name} has no date taken; add "date: YYYY-MM-DD" to the header')
		for kind, b in s.blocks:
			if kind == 'md':
				try:
					_, _, warns = md_render(b)
					for ln, w in warns:
						inbox.warn(s.md, ln, w)
				except MdError as e:
					inbox.error(s.md, e.line, str(e))
	return inbox, rows, probes


def print_problems(inbox: Inbox, out=print):
	for p in inbox.problems:
		out(p.format(inbox.root))
	e, w = len(inbox.errors), len(inbox.problems) - len(inbox.errors)
	out(f'{len(inbox.photos)} photo(s), {len(inbox.stories)} story(ies): {e} error(s), {w} warning(s)')


# --- media processing ---------------------------------------------------------

def sha256(path: Path):
	h = hashlib.sha256()
	with open(path, 'rb') as f:
		for chunk in iter(lambda: f.read(1 << 20), b''):
			h.update(chunk)
	return h.hexdigest()


def out_name(key, name, src_sha, recipe, ext):
	h = hashlib.sha256(f'{PIPELINE_VERSION}|{name}|{recipe}|{src_sha}'.encode()).hexdigest()[:10]
	return f'{key}/{name}-{h}.{ext}'


def write_atomic(path: Path, data: bytes):
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_name(path.name + '.tmp')
	tmp.write_bytes(data)
	os.replace(tmp, path)


def plan(job: Job, src_sha):
	if job.kind == 'clip':
		h = out_name(job.key, 'clip', src_sha, '', 'mp4').rsplit('-', 1)[1][:-4]
		return {'mp4': f'{job.key}-{h}.mp4', 'poster': f'{job.key}-{h}-poster.webp'}
	f = f'{job.focus[0]:.4f},{job.focus[1]:.4f}'
	return {
		'sq480': out_name(job.key, 'sq480', src_sha, f, 'webp'),
		'sq960': out_name(job.key, 'sq960', src_sha, f, 'webp'),
		'w1280': out_name(job.key, 'w1280', src_sha, '', 'webp'),
		'w2560': out_name(job.key, 'w2560', src_sha, '', 'webp'),
		'full': out_name(job.key, 'full', src_sha, '', 'jpg'),
	}


def process(job: Job, media: Path, cached: dict | None, log):
	src_sha = sha256(job.src)
	files = plan(job, src_sha)
	missing = [n for n, rel in files.items() if not (media / rel).is_file()]
	meta = cached.get('meta') if cached and cached.get('sha') == src_sha else None
	if not missing and meta:
		return {'sha': src_sha, 'source': str(job.src), 'files': files, 'meta': meta, 'reused': True}
	if job.kind == 'clip':
		mp4, poster, w, h, d = clips.process(job.src)
		write_atomic(media / files['mp4'], mp4)
		write_atomic(media / files['poster'], poster)
		meta = {'width': w, 'height': h, 'duration': round(d, 2), 'bytes': len(mp4)}
		log(f'  clip  {job.key}: {w}×{h}, {d:.1f} s, {len(mp4) / 1e6:.2f} MB')
		return {'sha': src_sha, 'source': str(job.src), 'files': files, 'meta': meta, 'reused': False}
	img, prof = images.load_upright(job.src, job.kind)
	w, h = img.size
	meta = dict(meta or {})
	meta.update({'width': w, 'height': h, 'icc': bool(prof)})
	want_der = [n for n in ('sq480', 'sq960', 'w1280', 'w2560') if n in missing]
	if want_der:
		der = images.derivatives(img, prof, job.focus)
		for n in want_der:
			write_atomic(media / files[n], der[n])
	if 'full' in missing or 'hdr' not in meta:
		if job.kind == 'jpeg':
			full, info = images.full_from_jpeg(job.src)
			meta['hdr_note'] = None
		else:
			full, info = images.full_from_heic(job.src, img, prof, shot.apple_headroom(job.row))
			meta['hdr_note'] = info.get('hdr_note')
		meta['hdr'] = info['hdr']
		meta['orientation'] = info.get('orientation', 1)
		meta['dropped_images'] = info.get('dropped_images', 0)
		write_atomic(media / files['full'], full)
	log(f'  photo {job.key}: {w}×{h} {job.kind}{" HDR" if meta["hdr"] else ""} ({", ".join(missing) or "metadata"} written)')
	return {'sha': src_sha, 'source': str(job.src), 'files': files, 'meta': meta, 'reused': False}


# --- data model ------------------------------------------------------------

def iso_of_md_date(v):
	d = parse_md_date(v)
	if isinstance(d, dt.datetime):
		return d.isoformat(timespec='seconds')
	return d.isoformat()


def sort_key(iso):
	d = render.parse_iso(iso) or dt.datetime(1900, 1, 1)
	if isinstance(d, dt.datetime) and d.tzinfo:
		d = d.astimezone(dt.timezone.utc).replace(tzinfo=None)
	return d


def photo_object(slug, place, note, alt, date_override, res, row, show_gps):
	m = res['meta']
	src = {k: res['files'][k] for k in ('sq480', 'sq960', 'w1280', 'w2560', 'full')}
	sd = shot.shot_details(row, m['width'], m['height'], show_gps)
	date = iso_of_md_date(date_override) if date_override else sd['taken']
	return {
		'type': 'photo', 'slug': slug, 'date': date, 'year': int(date[:4]) if date else None,
		'place': place, 'note': note, 'alt': alt or f'Photo taken in {place}',
		'width': m['width'], 'height': m['height'], 'src': src, 'hdr': bool(m.get('hdr')), 'shot': sd,
	}


def read_minutes(words):
	return max(1, round(words / WPM))


def meta_description(summary, first_text, limit=155):
	s = (summary or first_text or '').strip()
	if len(s) <= limit:
		return s
	cut = s[:limit].rsplit(' ', 1)[0].rstrip(',;:.')
	return cut + '…'


def build(repo: Path, inbox_dir: Path, media_base: str, media_dir: Path, log=print, jobs_n=3):
	inbox, rows, probes = validate(inbox_dir)
	if inbox.errors:
		print_problems(inbox, log)
		raise SystemExit(1)
	for p in inbox.problems:
		log(p.format(inbox.root))
	media_base = media_base.rstrip('/')
	frames_html = repo / 'frames.html'
	template_path = repo / '_tools' / 'frames' / 'story.template.html'
	if not frames_html.is_file():
		raise SystemExit(f'error: {frames_html} not found (it must contain the <!-- frames:stats --> and <!-- frames:grid --> markers)')
	page = frames_html.read_text(encoding='utf-8')
	for name in ('stats', 'grid'):  # fail before touching anything
		render.fill_markers(page, name, '')
	template = template_path.read_text(encoding='utf-8') if inbox.stories else None
	if inbox.stories and template is None:
		raise SystemExit(f'error: {template_path} not found')

	media_dir.mkdir(parents=True, exist_ok=True)
	man_path = media_dir / MANIFEST
	try:
		manifest = json.loads(man_path.read_text())
		if manifest.get('version') != PIPELINE_VERSION:
			manifest = {'entries': {}}
	except (OSError, ValueError):
		manifest = {'entries': {}}
	old = manifest.get('entries', {})

	jobs = []
	for p in inbox.photos:
		focus = parse_focus(p.meta.fields['focus']) if 'focus' in p.meta.fields else (0.5, 0.5)
		jobs.append(Job(p.slug, p.image, probes[p.image][0], focus, rows.get(p.image, {})))
	for s in inbox.stories:
		used = {s.meta.fields['cover']}
		for kind, b in s.blocks:
			if kind == 'marker':
				used.update(b.files)
		for name in sorted(used):
			path = s.files[name]
			kind = 'clip' if path.suffix.lower() in CLIP_EXT else probes[path][0]
			jobs.append(Job(f'{s.slug}/{stem_slug(name)}', path, kind, (0.5, 0.5), rows.get(path, {})))

	log(f'processing {len(jobs)} file(s)…')
	with ThreadPoolExecutor(max_workers=jobs_n) as ex:
		results = list(ex.map(lambda j: process(j, media_dir, old.get(j.key), log), jobs))
	res = {j.key: r for j, r in zip(jobs, results)}
	reused = sum(1 for r in results if r['reused'])
	hdr_notes = [(j.src, r['meta'].get('hdr_note')) for j, r in zip(jobs, results) if r['meta'].get('hdr_note')]

	# items
	items = []
	for p in inbox.photos:
		f = p.meta.fields
		note = ' '.join(t.strip() for _, t in p.meta.body if t.strip())
		items.append(photo_object(p.slug, f['place'], note, f.get('alt'), f.get('date'), res[p.slug], rows.get(p.image, {}), f.get('gps', 'show') != 'hide'))
	stories = []
	for s in inbox.stories:
		f = s.meta.fields
		show_gps = f.get('gps', 'show') != 'hide'
		photos, index = [], {}

		def add(name, note='', alt=None):
			if name in index:
				if note and not photos[index[name]]['note']:
					photos[index[name]]['note'] = note
				return index[name]
			key = f'{s.slug}/{stem_slug(name)}'
			path = s.files[name]
			ph = photo_object(key, f['place'], note, alt, None, res[key], rows.get(path, {}), show_gps)
			index[name] = len(photos)
			photos.append(ph)
			return index[name]

		add(f['cover'], '', f.get('alt'))
		clip_data = {}
		blocks, words, first_text = [], 0, None
		for kind, b in s.blocks:
			if kind == 'md':
				h, w, _ = md_render(b)
				if h:
					blocks.append(('md', h))
				words += len(w)
				if first_text is None and w:
					first_text = ' '.join(w)
			else:
				if b.kind == 'image':
					add(b.files[0], b.note, b.alt)
				elif b.kind == 'images':
					for fn in b.files:
						add(fn)
				elif b.kind == 'clip':
					key = f'{s.slug}/{stem_slug(b.files[0])}'
					r = res[key]
					clip_data[b.files[0]] = {'mp4': r['files']['mp4'], 'poster': r['files']['poster'], 'width': r['meta']['width'], 'height': r['meta']['height']}
				blocks.append(('marker', b))
		cover = photos[0]
		date = iso_of_md_date(f['date']) if f.get('date') else cover['shot']['taken']
		for ph in photos:
			if not ph['date']:
				ph['date'], ph['year'] = date, int(date[:4])
		story = {
			'type': 'story', 'slug': s.slug, 'title': f['title'], 'place': f['place'], 'summary': f.get('summary', ''),
			'date': date, 'year': int(date[:4]), 'readMinutes': read_minutes(words), 'url': f'frames/{s.slug}.html',
			'cover': cover, 'photos': photos,
		}
		stories.append((story, blocks, index, clip_data, meta_description(f.get('summary'), first_text)))
		items.append(story)

	items.sort(key=lambda it: (sort_key(it['date']), it['slug']), reverse=True)
	years = sorted({it['year'] for it in items if it['year']})
	places = {it['place'].strip().casefold() for it in items}
	counts = {'photos': sum(1 for it in items if it['type'] == 'photo'), 'stories': len(stories), 'places': len(places), 'years': [years[0], years[-1]] if years else []}
	data = {
		'version': 1, 'mediaBase': media_base,
		'generated': dt.datetime.now().astimezone().isoformat(timespec='seconds'),
		'counts': counts, 'items': items,
	}

	# story pages
	pages_dir = repo / 'frames'
	ordered = [it for it in items if it['type'] == 'story']
	written = set()
	for story, blocks, index, clip_data, desc in stories:
		k = ordered.index(story)
		nxt = ordered[(k + 1) % len(ordered)] if len(ordered) > 1 else None
		body = render.story_body(blocks, media_base, story['place'], index, story['photos'], clip_data, md_render)
		html = render.story_page(template, story, media_base, body, nxt, desc)
		pages_dir.mkdir(exist_ok=True)
		out = pages_dir / f'{story["slug"]}.html'
		out.write_text(html, encoding='utf-8')
		written.add(out.name)
	removed_pages = []
	if pages_dir.is_dir():
		for pth in pages_dir.glob('*.html'):
			if pth.name not in written and render.GENERATED in pth.read_text(encoding='utf-8', errors='replace')[:2000]:
				pth.unlink()
				removed_pages.append(pth.name)

	# frames.html + frames.json
	page = render.fill_markers(page, 'stats', render.stats_html(counts))
	page = render.fill_markers(page, 'grid', lambda indent: render.grid_html(items, media_base, indent))
	frames_html.write_text(page, encoding='utf-8')
	(repo / 'frames.json').write_text(json.dumps(data, ensure_ascii=False, indent='\t') + '\n', encoding='utf-8')

	# prune media no longer referenced (deleted entries, changed sources)
	keep = {rel for r in results for rel in r['files'].values()}
	pruned = 0
	for pth in sorted(media_dir.rglob('*'), reverse=True):
		rel = pth.relative_to(media_dir).as_posix()
		if pth.is_file() and rel != MANIFEST and rel not in keep:
			pth.unlink()
			pruned += 1
		elif pth.is_dir() and not any(pth.iterdir()):
			pth.rmdir()
	manifest = {'version': PIPELINE_VERSION, 'entries': {j.key: res[j.key] for j in jobs}}
	for e in manifest['entries'].values():
		e.pop('reused', None)
	write_atomic(man_path, (json.dumps(manifest, indent='\t', ensure_ascii=False) + '\n').encode())

	log(f'built {counts["photos"]} photo(s), {counts["stories"]} story(ies): {len(jobs) - reused} processed, {reused} unchanged, {pruned} stale media file(s) removed' + (f', removed pages {", ".join(removed_pages)}' if removed_pages else ''))
	for src, note in hdr_notes:
		log(f'HDR fallback: {src.name}: {note}')
	return data, {'processed': len(jobs) - reused, 'reused': reused, 'pruned': pruned, 'hdr_notes': hdr_notes, 'removed_pages': removed_pages}
