"""Byte-level JPEG handling: lossless metadata strip that keeps the HDR gain map.

The entropy-coded image data (and tables) are copied verbatim, so pixels are untouched.
Kept: JFIF (minimal), ICC profile, Adobe APP14 (affects colour decoding), ISO 21496-1
gain-map metadata, and an MPF index pointing at the gain-map image (rebuilt with new
offsets). Everything else (Exif incl. GPS + thumbnail, XMP, IPTC, comments, maker
trailers, preview images) is dropped; then Exif with only Orientation, Artist and
Copyright is written back, plus a minimal XMP holding only the gain-map fields.
"""
import re
import struct
import xml.etree.ElementTree as ET
from dataclasses import dataclass

NS = {
	'x': 'adobe:ns:meta/',
	'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	'hdrgm': 'http://ns.adobe.com/hdr-gain-map/1.0/',
	'Container': 'http://ns.google.com/photos/1.0/container/',
	'Item': 'http://ns.google.com/photos/1.0/container/item/',
	'HDRGainMap': 'http://ns.apple.com/HDRGainMap/1.0/',
	'apdi': 'http://ns.apple.com/pixeldatainfo/1.0/',
}
KEEP_NS = ('hdrgm', 'HDRGainMap', 'apdi')
XMP_SIG = b'http://ns.adobe.com/xap/1.0/\x00'
EXIF_SIG = b'Exif\x00\x00'
ICC_SIG = b'ICC_PROFILE\x00'
MPF_SIG = b'MPF\x00'
ISO_SIG = b'urn:iso:std:iso:ts:21496:-1\x00'
APPLE_GAINMAP = 'urn:com:apple:photo:2020:aux:hdrgainmap'


class JpegError(Exception):
	pass


@dataclass
class Seg:
	marker: int  # second byte, e.g. 0xE1
	data: bytes  # full segment bytes incl. FF xx (and length)
	payload_off: int = 0  # absolute offset of payload in source file

	@property
	def payload(self):
		return self.data[4:] if len(self.data) >= 4 and self.marker not in NO_LEN else b''


NO_LEN = {0xD8, 0xD9, 0x01} | set(range(0xD0, 0xD8))


def parse(data: bytes, start: int = 0):
	"""Returns (segments, end_offset_after_EOI). Segments after SOS include the scan data."""
	if data[start:start + 2] != b'\xff\xd8':
		raise JpegError('not a JPEG (no SOI marker)')
	segs = [Seg(0xD8, data[start:start + 2])]
	i, n = start + 2, len(data)
	while i < n:
		if data[i] != 0xFF:
			raise JpegError(f'corrupt JPEG: expected marker at {i}')
		while i < n and data[i] == 0xFF:
			i += 1
		if i >= n:
			break
		m = data[i]
		mstart = i - 1
		i += 1
		if m == 0xD9:
			segs.append(Seg(m, b'\xff\xd9'))
			return segs, i
		if m in NO_LEN:
			segs.append(Seg(m, b'\xff' + bytes([m])))
			continue
		if i + 2 > n:
			raise JpegError('truncated JPEG')
		(ln,) = struct.unpack('>H', data[i:i + 2])
		seg_end = i + ln
		if m == 0xDA:  # SOS: scan data runs until the next real marker
			j = seg_end
			while True:
				j = data.find(b'\xff', j)
				if j < 0 or j + 1 >= n:
					raise JpegError('truncated JPEG scan (no EOI)')
				nb = data[j + 1]
				if nb == 0x00 or 0xD0 <= nb <= 0xD7 or nb == 0xFF:
					j += 1 if nb == 0xFF else 2
					continue
				break
			segs.append(Seg(m, data[mstart:j], i + 2))
			i = j
		else:
			if seg_end > n:
				raise JpegError('truncated JPEG segment')
			segs.append(Seg(m, data[mstart:seg_end], i + 2))
			i = seg_end
	raise JpegError('JPEG has no EOI marker')


def app(marker: int, payload: bytes) -> bytes:
	if len(payload) + 2 > 0xFFFF:
		raise JpegError('segment too large')
	return b'\xff' + bytes([marker]) + struct.pack('>H', len(payload) + 2) + payload


# --- MPF -------------------------------------------------------------------

def parse_mpf(seg: Seg):
	"""Returns (byte_order, [(attr, size, offset)], tiff_abs_offset)."""
	p = seg.payload
	tiff = p[4:]
	bo = tiff[:2]
	if bo == b'II':
		e = '<'
	elif bo == b'MM':
		e = '>'
	else:
		raise JpegError('bad MPF header')
	(ifd,) = struct.unpack(e + 'I', tiff[4:8])
	(cnt,) = struct.unpack(e + 'H', tiff[ifd:ifd + 2])
	entries = []
	for k in range(cnt):
		tag, typ, count, val = struct.unpack(e + 'HHII', tiff[ifd + 2 + 12 * k: ifd + 14 + 12 * k])
		if tag == 0xB002:
			raw = tiff[val:val + count]
			for q in range(count // 16):
				attr, size, off, _d1, _d2 = struct.unpack(e + 'IIIHH', raw[16 * q:16 * q + 16])
				entries.append((attr, size, off))
	return e, entries, seg.payload_off + 4


def build_mpf(sizes_offsets, attrs):
	"""Little-endian MPF APP2 payload. sizes_offsets: [(size, offset)] (offset relative to TIFF header)."""
	n = len(sizes_offsets)
	ifd_off = 8
	n_tags = 3
	entries_off = ifd_off + 2 + 12 * n_tags + 4
	t = b'II*\x00' + struct.pack('<I', ifd_off)
	t += struct.pack('<H', n_tags)
	t += struct.pack('<HHI4s', 0xB000, 7, 4, b'0100')
	t += struct.pack('<HHII', 0xB001, 4, 1, n)
	t += struct.pack('<HHII', 0xB002, 7, 16 * n, entries_off)
	t += struct.pack('<I', 0)
	for (size, off), attr in zip(sizes_offsets, attrs):
		t += struct.pack('<IIIHH', attr, size, off, 0, 0)
	return MPF_SIG + t


# --- XMP -------------------------------------------------------------------

def xmp_props(payload: bytes):
	"""Simple properties from kept namespaces + Container items. Returns (props, items, raw_text)."""
	txt = payload[len(XMP_SIG):].decode('utf-8', 'replace')
	m = re.search(r'<x:xmpmeta.*</x:xmpmeta>', txt, re.S)
	props, items = {}, []
	if not m:
		return props, items, txt
	try:
		root = ET.fromstring(m.group(0))
	except ET.ParseError:
		return props, items, txt
	want = {NS[k]: k for k in KEEP_NS}
	for desc in root.iter('{%s}Description' % NS['rdf']):
		for k, v in desc.attrib.items():
			if k.startswith('{'):
				uri, name = k[1:].split('}', 1)
				if uri in want:
					props[(want[uri], name)] = v
		for child in desc:
			if child.tag.startswith('{') and len(child) == 0 and child.text and child.text.strip():
				uri, name = child.tag[1:].split('}', 1)
				if uri in want:
					props[(want[uri], name)] = child.text.strip()
	for it in root.iter('{%s}Item' % NS['Container']):
		d = {}
		for k, v in it.attrib.items():
			if k.startswith('{%s}' % NS['Item']):
				d[k.split('}', 1)[1]] = v
		for child in it.iter():
			if child.tag.startswith('{%s}' % NS['Item']) and child.text:
				d[child.tag.split('}', 1)[1]] = child.text.strip()
			for k, v in child.attrib.items():
				if k.startswith('{%s}' % NS['Item']):
					d[k.split('}', 1)[1]] = v
		if d:
			items.append(d)
	return props, items, txt


def _esc(s):
	return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('"', '&quot;')


def build_xmp(props: dict, items=None) -> bytes:
	used = sorted({p for p, _ in props} | ({'Container', 'Item'} if items else set()))
	ns_attrs = ''.join(f'\n    xmlns:{p}="{NS[p]}"' for p in used)
	attrs = ''.join(f'\n    {p}:{n}="{_esc(v)}"' for (p, n), v in sorted(props.items()))
	inner = ''
	if items:
		lis = ''.join(
			'\n       <rdf:li rdf:parseType="Resource"><Container:Item' + ''.join(f' Item:{k}="{_esc(v)}"' for k, v in it.items()) + '/></rdf:li>'
			for it in items)
		inner = f'\n   <Container:Directory>\n    <rdf:Seq>{lis}\n    </rdf:Seq>\n   </Container:Directory>\n  '
	x = (
		'<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n'
		f'  <rdf:Description rdf:about=""{ns_attrs}{attrs}>{inner}</rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>'
	)
	return XMP_SIG + x.encode('utf-8')


# --- Exif ------------------------------------------------------------------

def build_exif(orientation=1, artist=None, copyright=None) -> bytes:
	"""Minimal little-endian Exif APP1 payload: IFD0 with Orientation/Artist/Copyright only."""
	entries = []
	if orientation and orientation != 1:
		entries.append((0x0112, 3, 1, struct.pack('<HH', orientation, 0)))
	for tag, s in ((0x013B, artist), (0x8298, copyright)):
		if s:
			b = s.encode('utf-8') + b'\x00'
			entries.append((tag, 2, len(b), b))
	entries.sort()
	ifd_off = 8
	data_off = ifd_off + 2 + 12 * len(entries) + 4
	ifd, extra = struct.pack('<H', len(entries)), b''
	for tag, typ, count, val in entries:
		if len(val) <= 4:
			ifd += struct.pack('<HHI', tag, typ, count) + val.ljust(4, b'\x00')
		else:
			ifd += struct.pack('<HHII', tag, typ, count, data_off + len(extra))
			extra += val + (b'\x00' if len(val) % 2 else b'')
	ifd += struct.pack('<I', 0)
	return EXIF_SIG + b'II*\x00' + struct.pack('<I', ifd_off) + ifd + extra


def exif_orientation(payload: bytes) -> int:
	t = payload[6:]
	if t[:2] == b'II':
		e = '<'
	elif t[:2] == b'MM':
		e = '>'
	else:
		return 1
	try:
		(ifd,) = struct.unpack(e + 'I', t[4:8])
		(cnt,) = struct.unpack(e + 'H', t[ifd:ifd + 2])
		for k in range(cnt):
			tag, typ, count = struct.unpack(e + 'HHI', t[ifd + 2 + 12 * k: ifd + 10 + 12 * k])
			if tag == 0x0112:
				(v,) = struct.unpack(e + 'H', t[ifd + 10 + 12 * k: ifd + 12 + 12 * k])
				return v if 1 <= v <= 8 else 1
	except struct.error:
		pass
	return 1


# --- image model -----------------------------------------------------------

@dataclass
class Image:
	segs: list
	jfif: bytes | None = None
	icc: list = None  # ICC APP2 payloads in order
	adobe: bytes | None = None
	iso: bytes | None = None  # ISO 21496-1 APP2 payload
	xmp: tuple = ({}, [])  # (props, container items)
	orientation: int = 1
	body: list = None  # non-APP segments (DQT, SOF, DHT, SOS..., EOI) verbatim
	mpf: tuple | None = None

	def is_gainmap(self):
		props = self.xmp[0]
		if self.iso is not None and len(self.iso) > len(ISO_SIG) + 4:
			return True
		if any(p == 'hdrgm' for p, _ in props) and ('hdrgm', 'GainMapMax') in props:
			return True
		if props.get(('apdi', 'AuxiliaryImageType')) == APPLE_GAINMAP:
			return True
		return False


def read_image(data: bytes, start=0):
	segs, end = parse(data, start)
	im = Image(segs, icc=[], body=[])
	for s in segs[1:]:
		p = s.payload
		if s.marker == 0xE0 and p.startswith(b'JFIF\x00') and im.jfif is None:
			im.jfif = p[:12] + b'\x00\x00'  # drop any JFIF thumbnail
		elif s.marker == 0xE1 and p.startswith(EXIF_SIG):
			im.orientation = exif_orientation(p)
		elif s.marker == 0xE1 and p.startswith(XMP_SIG):
			props, items, _ = xmp_props(p)
			old = im.xmp
			im.xmp = ({**old[0], **props}, old[1] or items)
		elif s.marker == 0xE2 and p.startswith(ICC_SIG):
			im.icc.append(p)
		elif s.marker == 0xE2 and p.startswith(MPF_SIG):
			im.mpf = parse_mpf(s)
		elif s.marker == 0xE2 and p.startswith(ISO_SIG):
			im.iso = p
		elif s.marker == 0xEE and p.startswith(b'Adobe'):
			im.adobe = p
		elif 0xE0 <= s.marker <= 0xEF or s.marker == 0xFE:
			pass  # every other APPn / COM is dropped
		else:
			im.body.append(s.data)
	return im, end


def secondary_images(data: bytes, im: Image):
	"""Images listed in MPF after the primary, as (attr, bytes)."""
	if not im.mpf:
		return []
	_e, entries, base = im.mpf
	out = []
	for attr, size, off in entries[1:]:
		if off == 0 or base + off + size > len(data):
			continue
		chunk = data[base + off: base + off + size]
		if chunk[:2] == b'\xff\xd8':
			out.append((attr, chunk))
	return out


def encode(im: Image, exif: bytes | None, xmp: bytes | None, with_mpf=False, keep_iso=True) -> list:
	"""Header segment list (bytes) + body; MPF placeholder index returned via a marker object."""
	parts = [b'\xff\xd8']
	if im.jfif:
		parts.append(app(0xE0, im.jfif))
	if exif:
		parts.append(app(0xE1, exif))
	if xmp:
		parts.append(app(0xE1, xmp))
	for p in im.icc or []:
		parts.append(app(0xE2, p))
	if keep_iso and im.iso:
		parts.append(app(0xE2, im.iso))
	mpf_index = None
	if with_mpf:
		mpf_index = len(parts)
		parts.append(None)
	if im.adobe:
		parts.append(app(0xEE, im.adobe))
	parts.extend(im.body)
	return parts, mpf_index


def assemble(primary_parts, mpf_index, secondaries, attrs):
	"""Join primary + secondaries, filling the MPF segment with correct sizes/offsets."""
	if mpf_index is None:
		return b''.join(primary_parts)
	n = 1 + len(secondaries)
	placeholder = app(0xE2, build_mpf([(0, 0)] * n, attrs))
	parts = list(primary_parts)
	parts[mpf_index] = placeholder
	before = sum(len(p) for p in parts[:mpf_index])
	tiff_pos = before + 4 + len(MPF_SIG)
	primary_len = sum(len(p) for p in parts)
	so = [(primary_len, 0)]
	pos = primary_len
	for s in secondaries:
		so.append((len(s), pos - tiff_pos))
		pos += len(s)
	parts[mpf_index] = app(0xE2, build_mpf(so, attrs))
	return b''.join(parts) + b''.join(secondaries)


def clean_secondary(chunk: bytes) -> bytes:
	im, _ = read_image(chunk)
	props = {k: v for k, v in im.xmp[0].items()}
	xmp = build_xmp(props) if props else None
	parts, _ = encode(im, None, xmp)
	return b''.join(parts)


def strip(data: bytes, artist: str, copyright: str):
	"""Lossless strip. Returns (bytes, info) where info = {orientation, hdr, gainmaps, dropped_images}."""
	im, end = read_image(data)
	secs = secondary_images(data, im)
	gain = []
	attrs = [0x030000]
	dropped = 0
	for attr, chunk in secs:
		try:
			sim, _ = read_image(chunk)
		except JpegError:
			dropped += 1
			continue
		if sim.is_gainmap():
			gain.append(clean_secondary(chunk))
			attrs.append(attr)
		else:
			dropped += 1
	props, items = im.xmp
	exif = build_exif(im.orientation, artist, copyright)
	xmp = None
	if gain:
		keep = dict(props)
		if items or ('hdrgm', 'Version') in keep:
			keep.setdefault(('hdrgm', 'Version'), '1.0')
			gm_sem = next((it.get('Semantic') for it in items[1:] if it.get('Semantic')), 'GainMap')
			new_items = [{'Semantic': 'Primary', 'Mime': 'image/jpeg'}]
			for g in gain:
				new_items.append({'Semantic': gm_sem, 'Mime': 'image/jpeg', 'Length': str(len(g))})
			xmp = build_xmp(keep, new_items)
		elif keep:
			xmp = build_xmp(keep)
	parts, mpf_index = encode(im, exif, xmp, with_mpf=bool(gain), keep_iso=bool(gain))
	out = assemble(parts, mpf_index, gain, attrs[:1 + len(gain)])
	return out, {'orientation': im.orientation, 'hdr': bool(gain), 'gainmaps': len(gain), 'dropped_images': dropped}


def make_ultrahdr(primary_jpeg: bytes, gainmap_jpeg: bytes, gm: dict, artist: str, copyright: str, orientation=1) -> bytes:
	"""Assemble an Ultra HDR JPEG (Adobe gain-map XMP + Google container + MPF).

	gm: GainMapMin/GainMapMax/HDRCapacityMin/HDRCapacityMax (log2), Gamma, OffsetSDR, OffsetHDR.
	"""
	im, _ = read_image(primary_jpeg)
	g, _ = read_image(gainmap_jpeg)
	gprops = {('hdrgm', 'Version'): '1.0'}
	for k in ('GainMapMin', 'GainMapMax', 'Gamma', 'OffsetSDR', 'OffsetHDR', 'HDRCapacityMin', 'HDRCapacityMax'):
		gprops[('hdrgm', k)] = f'{gm[k]:.6f}'.rstrip('0').rstrip('.') if isinstance(gm[k], float) else str(gm[k])
	gprops[('hdrgm', 'BaseRenditionIsHDR')] = 'False'
	gparts, _ = encode(g, None, build_xmp(gprops))
	gbytes = b''.join(gparts)
	items = [{'Semantic': 'Primary', 'Mime': 'image/jpeg'}, {'Semantic': 'GainMap', 'Mime': 'image/jpeg', 'Length': str(len(gbytes))}]
	xmp = build_xmp({('hdrgm', 'Version'): '1.0'}, items)
	parts, mpf_index = encode(im, build_exif(orientation, artist, copyright), xmp, with_mpf=True)
	return assemble(parts, mpf_index, [gbytes], [0x030000, 0])
