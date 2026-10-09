"""A deliberately small, safe Markdown renderer.

Supports paragraphs, ## headings, - / 1. lists, > quotes, **bold**, *italic*, [links](url)
and `code` (rendered as plain text). All text is HTML-escaped; raw HTML is shown as text.
"""
import re

SITE_HOSTS = ('devrobotics.dev', 'www.devrobotics.dev')
SAFE_URL = re.compile(r'^(https?://[^\s<>"]+|mailto:[^\s<>"]+|/[^\s<>"]*|#[^\s<>"]*)$', re.I)


def esc(s):
	"""Escape for text and double-quoted attributes."""
	return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')


class MdError(Exception):
	def __init__(self, line, msg):
		super().__init__(msg)
		self.line = line


def _link(text, url, line):
	url = url.strip()
	if not SAFE_URL.match(url):
		raise MdError(line, f'link must start with https://, http://, mailto: or /: {url}')
	attrs = ''
	m = re.match(r'^https?://([^/:?#]+)', url, re.I)
	if m and m.group(1).lower() not in SITE_HOSTS:
		attrs = ' target="_blank" rel="noopener"'
	return f'<a href="{esc(url)}"{attrs}>{inline(text, line, links=False)}</a>'


def inline(s, line=0, links=True):
	keep = []

	def stash(h):
		keep.append(h)
		return f'\x00{len(keep) - 1}\x00'

	s = s.replace('\x00', '')
	s = re.sub(r'`([^`]+)`', lambda m: stash(esc(m.group(1))), s)
	if links:
		s = re.sub(r'\[([^\]]+)\]\(\s*([^)\s]+)\s*\)', lambda m: stash(_link(m.group(1), m.group(2), line)), s)
	s = esc(s)
	s = re.sub(r'\*\*(?=\S)(.+?)(?<=\S)\*\*', r'<strong>\1</strong>', s)
	s = re.sub(r'__(?=\S)(.+?)(?<=\S)__', r'<strong>\1</strong>', s)
	s = re.sub(r'(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])', r'<em>\1</em>', s)
	s = re.sub(r'(?<![_\w])_(?=\S)(.+?)(?<=\S)_(?![_\w])', r'<em>\1</em>', s)
	return re.sub(r'\x00(\d+)\x00', lambda m: keep[int(m.group(1))], s)


def render(lines):
	"""lines: [(line_no, text)] -> (html, plain_text_words, warnings)"""
	out, warnings, words = [], [], []
	i, n = 0, len(lines)

	def text_of(t):
		words.extend(re.sub(r'[`*_\[\]()#>]', ' ', re.sub(r'\]\([^)]*\)', ']', t)).split())

	while i < n:
		ln, t = lines[i]
		s = t.strip()
		if not s:
			i += 1
			continue
		m = re.match(r'^(#{1,6})\s+(.*?)\s*#*\s*$', s)
		if m:
			if len(m.group(1)) != 2:
				warnings.append((ln, f'"{m.group(1)}" headings are shown as "##" section headings'))
			text_of(m.group(2))
			out.append(f'<h2>{inline(m.group(2), ln)}</h2>')
			i += 1
			continue
		if re.match(r'^[-*+]\s+', s) or re.match(r'^\d+[.)]\s+', s):
			ordered = bool(re.match(r'^\d+[.)]\s+', s))
			pat = r'^\d+[.)]\s+' if ordered else r'^[-*+]\s+'
			items = []
			while i < n and lines[i][1].strip():
				ln2, t2 = lines[i]
				s2 = t2.strip()
				if re.match(pat, s2):
					items.append([ln2, re.sub(pat, '', s2)])
				elif items:
					items[-1][1] += ' ' + s2
				i += 1
			for _, it in items:
				text_of(it)
			tag = 'ol' if ordered else 'ul'
			out.append(f'<{tag}>' + ''.join(f'<li>{inline(it, l2)}</li>' for l2, it in items) + f'</{tag}>')
			continue
		if s.startswith('>'):
			paras, cur = [], []
			while i < n and lines[i][1].strip().startswith('>'):
				q = re.sub(r'^>\s?', '', lines[i][1].strip())
				if q.strip():
					cur.append(q.strip())
				elif cur:
					paras.append(cur)
					cur = []
				i += 1
			if cur:
				paras.append(cur)
			for p in paras:
				text_of(' '.join(p))
			out.append('<blockquote>' + ''.join(f'<p>{inline(" ".join(p), ln)}</p>' for p in paras) + '</blockquote>')
			continue
		para = []
		while i < n and lines[i][1].strip():
			s2 = lines[i][1].strip()
			if para and (re.match(r'^(#{1,6})\s', s2) or re.match(r'^[-*+]\s+', s2) or s2.startswith('>')):
				break
			para.append(s2)
			i += 1
		joined = ' '.join(para)
		text_of(joined)
		out.append(f'<p>{inline(joined, ln)}</p>')
	return '\n'.join(out), words, warnings
