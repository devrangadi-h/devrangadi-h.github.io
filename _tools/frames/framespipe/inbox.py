"""Parse and validate the Frames Inbox (photos/<slug>/photo.md, stories/<slug>/story.md).

Every problem is collected (file + line) instead of stopping at the first one.
"""
import datetime as dt
import re
from dataclasses import dataclass, field
from pathlib import Path

IMAGE_EXT = {'.jpg', '.jpeg', '.heic', '.heif'}
CLIP_EXT = {'.mp4', '.mov'}
IGNORED_FILES = {'.ds_store', 'thumbs.db', 'desktop.ini', '.localized'}
SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
PHOTO_FIELDS = {'place', 'gps', 'alt', 'focus', 'date'}
PHOTO_REQUIRED = {'place'}
STORY_FIELDS = {'title', 'place', 'cover', 'gps', 'date', 'summary', 'alt'}
STORY_REQUIRED = {'title', 'place', 'cover'}
YT_ID = r'[A-Za-z0-9_-]{11}'
YT_PATTERNS = [
	re.compile(r'^https?://(?:www\.)?youtu\.be/(' + YT_ID + r')(?:[?&#].*)?$'),
	re.compile(r'^https?://(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:.*&)?v=(' + YT_ID + r')(?:[&#].*)?$'),
	re.compile(r'^https?://(?:www\.|m\.)?youtube\.com/shorts/(' + YT_ID + r')(?:[/?&#].*)?$'),
]
# straight and typographic quotes (macOS/iOS autocorrect turns " into “ ”)
QUOTES = {'"': '"', '“': '”', '”': '”', '„': '”'}


@dataclass
class Problem:
	path: Path
	line: int | None
	msg: str
	level: str = 'error'  # or 'warning'

	def format(self, root: Path) -> str:
		try:
			p = self.path.relative_to(root)
		except ValueError:
			p = self.path
		loc = f'{p}:{self.line}' if self.line else f'{p}'
		return f'{self.level.upper():7} {loc}: {self.msg}'


@dataclass
class Meta:
	fields: dict  # key -> value
	lines: dict  # key -> line number
	body: list  # [(line_no, text)]


@dataclass
class Marker:
	kind: str  # image | images | clip | youtube
	line: int
	files: list = field(default_factory=list)
	note: str = ''
	alt: str | None = None
	full: bool = False
	url: str = ''
	yt_id: str = ''
	items: list = field(default_factory=list)  # images: [(file, note, alt|None, place|None)] in order
	place: str | None = None  # image: this photo's own Place


@dataclass
class PhotoEntry:
	slug: str
	folder: Path
	md: Path
	meta: Meta
	image: Path | None = None


@dataclass
class StoryEntry:
	slug: str
	folder: Path
	md: Path
	meta: Meta
	blocks: list = field(default_factory=list)  # ('md', [(line, text)]) | ('marker', Marker)
	files: dict = field(default_factory=dict)  # filename -> Path (images + clips present)


@dataclass
class Inbox:
	root: Path
	photos: list = field(default_factory=list)
	stories: list = field(default_factory=list)
	problems: list = field(default_factory=list)

	def error(self, path, line, msg):
		self.problems.append(Problem(path, line, msg, 'error'))

	def warn(self, path, line, msg):
		self.problems.append(Problem(path, line, msg, 'warning'))

	@property
	def errors(self):
		return [p for p in self.problems if p.level == 'error']


def parse_front_matter(inbox: Inbox, path: Path, allowed: set, required: set) -> Meta | None:
	try:
		text = path.read_text(encoding='utf-8')
	except UnicodeDecodeError:
		inbox.error(path, None, 'not UTF-8 text')
		return None
	text = text.lstrip('﻿')
	lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
	first = next((i for i, l in enumerate(lines) if l.strip()), None)
	if first is None or lines[first].strip() != '---':
		inbox.error(path, (first or 0) + 1, 'must start with a "---" line, then the header fields, then another "---" line')
		return None
	end = next((i for i in range(first + 1, len(lines)) if lines[i].strip() == '---'), None)
	if end is None:
		inbox.error(path, first + 1, 'header is never closed: add a "---" line after the last field')
		return None
	fields, where = {}, {}
	for i in range(first + 1, end):
		raw = lines[i]
		s = raw.strip()
		if not s or s.startswith('#'):
			continue
		m = re.match(r'^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$', s)
		if not m:
			inbox.error(path, i + 1, f'not a "field: value" line: {s!r}')
			continue
		key, val = m.group(1), m.group(2).strip()
		lk = key.lower()
		if lk not in allowed:
			inbox.error(path, i + 1, f'unknown field "{key}" (allowed: {", ".join(sorted(allowed))})')
			continue
		if key != lk:
			inbox.error(path, i + 1, f'field names are lowercase: write "{lk}:" instead of "{key}:"')
			continue
		if len(val) >= 2 and val[0] in QUOTES and val[-1] == QUOTES[val[0]]:
			val = val[1:-1].strip()
		elif len(val) >= 2 and val[0] == "'" and val[-1] == "'":
			val = val[1:-1].strip()
		if lk in fields:
			inbox.error(path, i + 1, f'"{lk}" is given twice (first on line {where[lk]})')
			continue
		fields[lk] = val
		where[lk] = i + 1
	for r in sorted(required):
		if not fields.get(r):
			inbox.error(path, where.get(r, first + 1), f'required field "{r}" is missing or empty')
	meta = Meta(fields, where, [(i + 1, lines[i]) for i in range(end + 1, len(lines))])
	check_common_fields(inbox, path, meta)
	return meta


def check_common_fields(inbox, path, meta):
	f, ln = meta.fields, meta.lines
	if 'gps' in f and f['gps'].lower() not in ('show', 'hide'):
		inbox.error(path, ln['gps'], f'gps must be "show" or "hide", not {f["gps"]!r}')
	elif 'gps' in f:
		f['gps'] = f['gps'].lower()
	if 'focus' in f and parse_focus(f['focus']) is None:
		inbox.error(path, ln['focus'], f'focus must look like "50% 30%" (x then y, each 0–100%), not {f["focus"]!r}')
	if 'date' in f and parse_md_date(f['date']) is None:
		inbox.error(path, ln['date'], f'date must be a real date like 2024-04-03 (or 2024-04-03 18:30), not {f["date"]!r}')


def parse_focus(s):
	m = re.match(r'^(\d+(?:\.\d+)?)\s*%\s*,?\s*(\d+(?:\.\d+)?)\s*%$', s.strip())
	if not m:
		return None
	x, y = float(m.group(1)), float(m.group(2))
	if not (0 <= x <= 100 and 0 <= y <= 100):
		return None
	return x / 100, y / 100


def parse_md_date(s):
	"""Returns a datetime/date or None. Accepts YYYY-MM-DD, optional time, optional offset."""
	s = s.strip()
	try:
		if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
			return dt.date.fromisoformat(s)
		if re.match(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$', s):
			return dt.datetime.fromisoformat(s.replace(' ', 'T').replace('Z', '+00:00'))
	except ValueError:
		return None
	return None


def visible_files(folder: Path):
	out = []
	for p in sorted(folder.iterdir()):
		if p.name.startswith('.') or p.name.lower() in IGNORED_FILES:
			continue
		out.append(p)
	return out


def entry_folders(base: Path):
	if not base.is_dir():
		return []
	return [p for p in sorted(base.iterdir()) if p.is_dir() and not p.name.startswith(('_', '.'))]


def check_slug(inbox, folder):
	if not SLUG_RE.match(folder.name):
		suggestion = re.sub(r'[^a-z0-9]+', '-', folder.name.lower()).strip('-')
		inbox.error(folder, None, f'folder name "{folder.name}" is not a valid slug (lowercase words joined by hyphens)' + (f', e.g. "{suggestion}"' if suggestion else ''))
		return False
	return True


def stem_slug(name: str) -> str:
	return re.sub(r'[^a-z0-9]+', '-', Path(name).stem.lower()).strip('-')


def load_inbox(root: Path) -> Inbox:
	inbox = Inbox(root)
	if not root.is_dir():
		inbox.error(root, None, 'Inbox folder does not exist')
		return inbox
	for sub in ('photos', 'stories'):
		if not (root / sub).is_dir():
			inbox.warn(root / sub, None, 'folder is missing (nothing to read here)')
	for p in visible_files(root):
		if p.is_dir() and p.name not in ('photos', 'stories') and not p.name.startswith('_'):
			inbox.warn(p, None, 'ignored: only photos/ and stories/ are read')
	for folder in entry_folders(root / 'photos'):
		load_photo(inbox, folder)
	for folder in entry_folders(root / 'stories'):
		load_story(inbox, folder)
	seen = {}
	for e in inbox.photos + inbox.stories:
		if e.slug in seen:
			inbox.error(e.folder, None, f'slug "{e.slug}" is used by both {seen[e.slug]} and this folder; slugs must be unique across photos and stories')
		else:
			seen[e.slug] = e.folder.relative_to(root)
	return inbox


def load_photo(inbox, folder):
	ok = check_slug(inbox, folder)
	md = folder / 'photo.md'
	images, others = [], []
	for p in visible_files(folder):
		if p.name == 'photo.md':
			continue
		if p.is_dir():
			inbox.error(p, None, 'unexpected folder inside a Photo folder')
		elif p.suffix.lower() in IMAGE_EXT:
			images.append(p)
		elif p.suffix.lower() == '.md':
			inbox.error(p, None, 'a Photo folder has exactly one photo.md (is this a story? those go in stories/)')
		else:
			others.append(p)
	for p in others:
		kind = 'clips only go in Stories' if p.suffix.lower() in CLIP_EXT else 'unsupported format (use JPEG or HEIC)'
		inbox.error(p, None, f'{kind}: {p.name}')
	if not images:
		inbox.error(folder, None, 'no image found (put exactly one .jpg or .heic next to photo.md)')
	elif len(images) > 1:
		inbox.error(folder, None, f'more than one image ({", ".join(p.name for p in images)}); a Photo folder holds exactly one')
	if not md.is_file():
		inbox.error(md, None, 'photo.md is missing')
		return
	meta = parse_front_matter(inbox, md, PHOTO_FIELDS, PHOTO_REQUIRED)
	if meta is None:
		return
	note = ' '.join(t.strip() for _, t in meta.body if t.strip())
	if re.search(r'<\s*insert\b', note, re.I):
		inbox.error(md, next(l for l, t in meta.body if re.search(r'<\s*insert\b', t, re.I)), 'insert markers only work in story.md')
	if not note:
		inbox.warn(md, None, 'no Note under the header (the tile will show only the place)')
	if ok:
		inbox.photos.append(PhotoEntry(folder.name, folder, md, meta, images[0] if len(images) == 1 else None))


MARKER_START = re.compile(r'^\s*<\s*insert\b', re.I)


def _close_quote(s, start):
	ends = [x for x in (s.find('"', start), s.find('\u201d', start)) if x >= 0]
	return min(ends) if ends else -1


def tokenize_marker(s):
	"""Split the inside of <insert ...> into tokens: ('word', x), ('quoted', x), ('alt', x), ('place', x)."""
	toks, i, n = [], 0, len(s)
	while i < n:
		c = s[i]
		if c.isspace():
			i += 1
			continue
		m = re.match(r'(alt|place)\s*=\s*', s[i:], re.I)
		if m and i + m.end() < n and s[i + m.end()] in QUOTES:
			j = i + m.end()
			k = _close_quote(s, j + 1)
			name = m.group(1).lower()
			if k < 0:
				raise ValueError(f'{name}="…" is missing its closing quote')
			toks.append((name, s[j + 1:k].strip()))
			i = k + 1
			continue
		if c in QUOTES:
			k = _close_quote(s, i + 1)
			if k < 0:
				raise ValueError('a quoted note is missing its closing quote')
			toks.append(('quoted', s[i + 1:k].strip()))
			i = k + 1
			continue
		m = re.match(r'[^\s"“”„]+', s[i:])
		toks.append(('word', m.group(0)))
		i += m.end()
	return toks


def parse_marker(line_no, line):
	"""Returns (Marker, None) or (None, error message)."""
	s = line.strip()
	m = re.match(r'^<\s*insert\s+(.*?)\s*>$', s, re.I | re.S)
	if not m:
		if not s.endswith('>'):
			return None, 'marker must end with ">" on the same line'
		return None, 'marker needs a type: image, images, clip or youtube'
	try:
		toks = tokenize_marker(m.group(1))
	except ValueError as e:
		return None, str(e)
	if not toks or toks[0][0] != 'word':
		return None, 'marker needs a type right after "insert": image, images, clip or youtube'
	kind = toks[0][1].lower()
	rest = toks[1:]
	mk = Marker(kind, line_no)
	words = [v for t, v in rest if t == 'word']
	quoted = [v for t, v in rest if t == 'quoted']
	alts = [v for t, v in rest if t == 'alt']
	places = [v for t, v in rest if t == 'place']
	if kind == 'image':
		files = [w for w in words if w.lower() != 'full']
		flags = [w for w in words if w.lower() == 'full']
		if len(files) != 1:
			return None, f'"insert image" takes exactly one file name (got {len(files)}); use "insert images" for 2–3 side by side'
		if len(quoted) > 1:
			return None, 'only one quoted note is allowed'
		if len(alts) > 1 or len(flags) > 1:
			return None, 'alt= and full may each appear once'
		if rest and rest[0] != ('word', files[0]):
			return None, 'the file name comes first: <insert image file.jpg "Note" alt="…" full>'
		mk.files, mk.note, mk.full = files, quoted[0] if quoted else '', bool(flags)
		mk.alt = alts[0] if alts else None
		if len(places) > 1:
			return None, 'place= may appear once'
		mk.place = places[0] if places else None
		if places and not places[0]:
			return None, 'place="" is empty'
		if alts and not alts[0]:
			return None, 'alt="" is empty'
	elif kind == 'images':
		# Each file may be followed by its own "Note" and alt="…":
		# <insert images a.jpg "Note A" alt="…" b.jpg "Note B">
		if any(w.lower() == 'full' for w in words):
			return None, '"full" only works with "insert image"'
		if rest and rest[0][0] != 'word':
			return None, 'the first file name comes first: <insert images a.jpg "Note" b.jpg "Note">'
		items = []
		for t, v in rest:
			if t == 'word':
				items.append([v, '', None, None])
			elif t == 'quoted':
				if items[-1][1]:
					return None, f'{items[-1][0]} has two quoted notes'
				items[-1][1] = v
			elif t == 'alt':
				if items[-1][2] is not None:
					return None, f'{items[-1][0]} has two alt= values'
				if not v:
					return None, 'alt="" is empty'
				items[-1][2] = v
			elif t == 'place':
				if items[-1][3] is not None:
					return None, f'{items[-1][0]} has two place= values'
				if not v:
					return None, 'place="" is empty'
				items[-1][3] = v
		if not 2 <= len(items) <= 3:
			return None, f'"insert images" takes 2 or 3 file names (got {len(items)}); use "insert image" for one'
		mk.items = [tuple(i) for i in items]
		mk.files = [i[0] for i in items]
	elif kind == 'clip':
		if alts or places:
			return None, 'clips take a quoted note, not alt= or place='
		if len(words) != 1:
			return None, f'"insert clip" takes exactly one file name (got {len(words)})'
		if len(quoted) > 1:
			return None, 'only one quoted note is allowed'
		mk.files, mk.note = words, quoted[0] if quoted else ''
	elif kind == 'youtube':
		if alts or places or len(words) != 1 or len(quoted) > 1:
			return None, 'use <insert youtube https://youtu.be/ID "Title"> (one link, optional quoted title)'
		url = words[0]
		for pat in YT_PATTERNS:
			ym = pat.match(url)
			if ym:
				mk.yt_id = ym.group(1)
				break
		else:
			return None, f'not a YouTube video link: {url} (use youtu.be/ID, youtube.com/watch?v=ID or youtube.com/shorts/ID)'
		mk.url, mk.note = url, quoted[0] if quoted else ''
	else:
		return None, f'unknown marker type "{toks[0][1]}" (use image, images, clip or youtube)'
	return mk, None


def load_story(inbox, folder):
	ok = check_slug(inbox, folder)
	md = folder / 'story.md'
	files, by_stem = {}, {}
	for p in visible_files(folder):
		if p.name == 'story.md':
			continue
		ext = p.suffix.lower()
		if p.is_dir():
			inbox.error(p, None, 'unexpected folder inside a Story folder')
		elif ext in IMAGE_EXT or ext in CLIP_EXT:
			files[p.name] = p
			st = stem_slug(p.name)
			if not st:
				inbox.error(p, None, 'file name needs at least one letter or digit')
			elif st in by_stem:
				inbox.error(p, None, f'"{p.name}" and "{by_stem[st]}" would publish under the same name "{st}"; rename one')
			else:
				by_stem[st] = p.name
		elif ext == '.md':
			inbox.error(p, None, 'a Story folder has exactly one story.md')
		else:
			inbox.error(p, None, f'unsupported format: {p.name} (images: JPEG or HEIC; clips: MP4 or MOV)')
	if not md.is_file():
		inbox.error(md, None, 'story.md is missing')
		return
	meta = parse_front_matter(inbox, md, STORY_FIELDS, STORY_REQUIRED)
	if meta is None:
		return
	entry = StoryEntry(folder.name, folder, md, meta, files=files)

	def check_file(name, line, want):
		if name not in files:
			hint = ''
			ci = [f for f in files if f.lower() == name.lower()]
			if ci:
				hint = f' (did you mean "{ci[0]}"? names are case-sensitive)'
			elif (folder / name).exists():
				hint = ' (that file has an unsupported format)'
			inbox.error(md, line, f'file "{name}" is not in this story folder{hint}')
			return False
		ext = Path(name).suffix.lower()
		if want == 'image' and ext not in IMAGE_EXT:
			inbox.error(md, line, f'"{name}" is not a photo (JPEG or HEIC)')
			return False
		if want == 'clip' and ext not in CLIP_EXT:
			inbox.error(md, line, f'"{name}" is not a clip (MP4 or MOV)')
			return False
		return True

	cover = meta.fields.get('cover')
	if cover:
		check_file(cover, meta.lines['cover'], 'image')
	used = {cover}
	para = []
	for line_no, text in meta.body:
		if MARKER_START.match(text):
			if para:
				entry.blocks.append(('md', para))
				para = []
			mk, err = parse_marker(line_no, text)
			if err:
				inbox.error(md, line_no, f'{err}: {text.strip()}')
				continue
			for f in mk.files:
				check_file(f, line_no, 'clip' if mk.kind == 'clip' else 'image')
				used.add(f)
			entry.blocks.append(('marker', mk))
		elif re.search(r'<\s*insert\b', text, re.I):
			inbox.error(md, line_no, 'an insert marker must be on its own line')
		else:
			para.append((line_no, text))
	if para:
		entry.blocks.append(('md', para))
	if not any(t.strip() for _, t in meta.body):
		inbox.warn(md, None, 'the story has no text yet')
	for name in files:
		if name not in used:
			inbox.warn(folder / name, None, 'not used by any insert marker or cover (it will not be published)')
	if ok:
		inbox.stories.append(entry)
