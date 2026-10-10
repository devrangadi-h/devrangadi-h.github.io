"""Read Shot details from originals with exiftool (one call for all files)."""
import datetime as dt
import json
import math
import re
import subprocess
from pathlib import Path

TAGS = [
	'Make', 'Model', 'LensModel', 'Lens', 'FocalLength', 'FocalLengthIn35mmFormat', 'FNumber',
	'ExposureTime', 'ISO', 'ExposureCompensation', 'DateTimeOriginal', 'OffsetTimeOriginal',
	'SubSecDateTimeOriginal', 'CreateDate', 'Orientation', 'Composite:GPSLatitude',
	'Composite:GPSLongitude', 'Composite:GPSAltitude', 'Apple:HDRHeadroom', 'Apple:HDRGain',
	'FileType', 'MIMEType', 'Duration', 'ImageWidth', 'ImageHeight', 'Rotation',
]


def read_all(paths):
	"""Returns {Path: dict} of raw exiftool values (-n numeric)."""
	paths = [Path(p) for p in paths]
	if not paths:
		return {}
	args = ['exiftool', '-j', '-n', '-q', '-api', 'LargeFileSupport=1', '-charset', 'filename=utf8']
	args += [f'-{t}' for t in TAGS]
	args += ['--', *map(str, paths)]
	r = subprocess.run(args, capture_output=True, text=True)
	try:
		rows = json.loads(r.stdout or '[]')
	except json.JSONDecodeError:
		raise RuntimeError(f'exiftool failed: {r.stderr.strip()}')
	out = {}
	for row in rows:
		out[Path(row['SourceFile'])] = row
	for p in paths:
		out.setdefault(p, {})
	return out


_MAKE_JUNK = re.compile(r'\s*(corporation|corp\.?|co\.,?\s*ltd\.?|imaging corp\.?|optical co\.,?\s*ltd\.?|company|inc\.?)\s*$', re.I)


def camera_name(make, model):
	make = (str(make).strip() if make else '')
	model = (str(model).strip() if model else '')
	make = _MAKE_JUNK.sub('', make).strip()
	if not model:
		return make or None
	if not make:
		return model
	first = make.split()[0].lower()
	if model.lower().startswith(first):
		return model
	return f'{make} {model}'


def _num(v):
	if v is None or v == '':
		return None
	try:
		return float(v)
	except (TypeError, ValueError):
		m = re.match(r'^\s*(-?[\d.]+)', str(v))
		return float(m.group(1)) if m else None


def fmt_mm(v):
	if v is None or v <= 0:
		return None
	if v < 10:
		s = f'{v:.1f}'.rstrip('0').rstrip('.')
	else:
		s = f'{round(v)}'
	return f'{s} mm'


def fmt_aperture(v):
	if v is None or v <= 0:
		return None
	return f'f/{v:.1f}' if v < 10 else f'f/{v:.0f}'


def fmt_shutter(t):
	if t is None or t <= 0:
		return None
	if t >= 1:
		s = f'{t:.1f}'.rstrip('0').rstrip('.')
		return f'{s} s'
	inv = 1 / t
	if abs(inv - round(inv)) < 0.05 * inv or inv >= 10:
		return f'1/{round(inv)} s'
	return f'{t:.1f} s'


def fmt_ev(v):
	if v is None:
		return None
	if abs(v) < 0.05:
		return '0 EV'
	s = f'{abs(v):.1f}'.rstrip('0').rstrip('.')
	return f'{"+" if v > 0 else "-"}{s} EV'


def taken_iso(row):
	"""Date taken as ISO 8601 (with offset when the file records one), else None."""
	raw = row.get('DateTimeOriginal') or row.get('CreateDate')
	if not raw or not isinstance(raw, str):
		return None
	m = re.match(r'^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})', raw.strip())
	if not m or m.group(1) == '0000':
		return None
	y, mo, d, h, mi, s = map(int, m.groups())
	try:
		dt.datetime(y, mo, d, h, mi, s)
	except ValueError:
		return None
	iso = f'{y:04d}-{mo:02d}-{d:02d}T{h:02d}:{mi:02d}:{s:02d}'
	off = row.get('OffsetTimeOriginal') if row.get('DateTimeOriginal') else None
	if isinstance(off, str) and re.match(r'^[+-]\d{2}:\d{2}$', off.strip()):
		iso += off.strip()
	return iso


def gps(row):
	lat, lon = _num(row.get('GPSLatitude')), _num(row.get('GPSLongitude'))
	if lat is None or lon is None or (lat == 0 and lon == 0) or abs(lat) > 90 or abs(lon) > 180:
		return None
	alt = _num(row.get('GPSAltitude'))
	return {'lat': round(lat, 5), 'lon': round(lon, 5), 'altitude': round(alt) if alt is not None else None}


# iPhones report lenses like "iPhone 18 Pro Max back triple camera 6.93mm f/1.48";
# show the module photographers know instead ("Main camera f/1.48")
_PHONE_LENS = re.compile(r'^.*?\b(back|front)\b.*?camera\s+([\d.]+)\s*mm\s+f/([\d.]+)\s*$', re.I)


def phone_lens(lens, fl):
	m = _PHONE_LENS.match(lens)
	if not m:
		return lens or None
	side, mm, ap = m.group(1).lower(), float(m.group(2)), m.group(3)
	if side == 'front':
		name = 'Front camera'
	elif mm < 3.5:
		name = 'Ultra Wide camera'
	elif mm < 7.5:
		name = 'Main camera'
	else:
		name = 'Telephoto camera'
	return f'{name} f/{ap}'


def shot_details(row, width, height, show_gps=True):
	fl = _num(row.get('FocalLength'))
	f35 = _num(row.get('FocalLengthIn35mmFormat'))
	iso = _num(row.get('ISO'))
	lens = row.get('LensModel') or row.get('Lens') or None
	lens = phone_lens(str(lens).strip(), fl) if lens else None
	return {
		'camera': camera_name(row.get('Make'), row.get('Model')),
		'lens': lens or None,
		'focalLength': fmt_mm(fl),
		'focal35': fmt_mm(f35) if f35 else None,
		'aperture': fmt_aperture(_num(row.get('FNumber'))),
		'shutter': fmt_shutter(_num(row.get('ExposureTime'))),
		'iso': int(iso) if iso else None,
		'exposureComp': fmt_ev(_num(row.get('ExposureCompensation'))),
		'megapixels': round(width * height / 1e6, 1) if width and height else None,
		'taken': taken_iso(row),
		'gps': gps(row) if show_gps else None,
	}


def apple_headroom(row):
	"""Apple's documented headroom formula from maker notes 0x21/0x30; None if absent."""
	m33, m48 = _num(row.get('HDRHeadroom')), _num(row.get('HDRGain'))
	if m33 is None or m48 is None:
		return None
	if m33 < 1.0:
		stops = -20.0 * m48 + 1.8 if m48 <= 0.01 else -0.101 * m48 + 1.601
	else:
		stops = -70.0 * m48 + 3.0 if m48 <= 0.01 else -0.303 * m48 + 2.303
	return 2 ** max(stops, 0.0)


def duration(row):
	return _num(row.get('Duration'))


def is_finite(x):
	return x is not None and math.isfinite(x)
