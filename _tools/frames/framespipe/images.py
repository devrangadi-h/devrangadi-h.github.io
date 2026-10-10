"""Photo processing: full-resolution file, WebP sizes, square crops."""
import io
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
import pillow_heif

from . import icc, jpeg

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = 400_000_000

ARTIST = 'Hardik Devrangadi'
COPYRIGHT = '© Hardik Devrangadi'
APPLE_GAINMAP = 'urn:com:apple:photo:2020:aux:hdrgainmap'
P3_PRIMARIES = 12  # H.273 colour_primaries: SMPTE EG 432-1 (Display P3)


def sniff(path: Path):
	with open(path, 'rb') as f:
		head = f.read(16)
	if head[:3] == b'\xff\xd8\xff':
		return 'jpeg'
	if head[4:8] == b'ftyp' and head[8:12] in (b'heic', b'heix', b'heim', b'heis', b'hevc', b'hevx', b'mif1', b'msf1', b'avif'):
		return 'avif' if head[8:12] == b'avif' else 'heic'
	return None


def probe(path: Path):
	"""Quick readability check; returns (kind, width, height) of the upright image or raises."""
	kind = sniff(path)
	if kind == 'jpeg':
		with Image.open(path) as im:
			if im.mode not in ('RGB', 'L'):
				raise ValueError(f'unsupported JPEG colour mode {im.mode} (export as RGB)')
			o = im.getexif().get(0x0112, 1)
			w, h = im.size
	elif kind == 'heic':
		hf = pillow_heif.open_heif(path)
		w, h = hf[0].size
		o = 1
		tc = (hf[0].info.get('nclx_profile') or {}).get('transfer_characteristics')
		if tc in (16, 18):
			raise ValueError('PQ/HLG-encoded HDR HEIC is not supported (export as a normal HEIC or JPEG)')
	else:
		raise ValueError('not a JPEG or HEIC file (check the format, not just the extension)')
	if o in (5, 6, 7, 8):
		w, h = h, w
	return kind, w, h


def _icc_of(img: Image.Image, info=None):
	info = info or img.info
	b = info.get('icc_profile')
	if b:
		return b
	nclx = info.get('nclx_profile') or {}
	if nclx.get('color_primaries') == P3_PRIMARIES:
		return icc.display_p3()
	return None


def load_upright(path: Path, kind: str):
	"""RGB image with orientation applied, plus its ICC profile (bytes or None)."""
	with Image.open(path) as im:
		im.load()
		prof = _icc_of(im)
		up = ImageOps.exif_transpose(im) if kind == 'jpeg' else im.copy()
	if up.mode != 'RGB':
		up = up.convert('RGB')
	return up, prof


def _resize_long(img, long_edge):
	w, h = img.size
	if max(w, h) <= long_edge:
		return img
	if w >= h:
		size = (long_edge, max(1, round(h * long_edge / w)))
	else:
		size = (max(1, round(w * long_edge / h)), long_edge)
	return img.resize(size, Image.LANCZOS)


def square_crop_box(w, h, focus):
	side = min(w, h)
	fx, fy = focus
	cx, cy = fx * w, fy * h
	left = min(max(round(cx - side / 2), 0), w - side)
	top = min(max(round(cy - side / 2), 0), h - side)
	return (left, top, left + side, top + side)


def webp_bytes(img, quality, prof):
	buf = io.BytesIO()
	kw = {'quality': quality, 'method': 6}
	if prof:
		kw['icc_profile'] = prof
	img.save(buf, 'WEBP', **kw)
	return buf.getvalue()


def derivatives(img, prof, focus):
	"""Returns {name: bytes} for w2560, w1280, sq960, sq480."""
	out = {}
	out['w2560'] = webp_bytes(_resize_long(img, 2560), 90, prof)
	out['w1280'] = webp_bytes(_resize_long(img, 1280), 85, prof)
	crop = img.crop(square_crop_box(*img.size, focus))
	for n in (960, 480):
		sq = crop if crop.size[0] <= n else crop.resize((n, n), Image.LANCZOS)
		out[f'sq{n}'] = webp_bytes(sq, 88 if n == 480 else 85, prof)
	return out


def decode_pixels(data: bytes):
	with Image.open(io.BytesIO(data)) as im:
		im.load()
		return im.mode, im.size, im.tobytes()


def full_from_jpeg(path: Path):
	"""Lossless strip. Returns (bytes, info). Raises if decoded pixels differ."""
	src = path.read_bytes()
	out, info = jpeg.strip(src, ARTIST, COPYRIGHT)
	if decode_pixels(src) != decode_pixels(out):
		raise RuntimeError(f'{path}: lossless strip changed pixels (refusing to publish)')
	return out, info


def _srgb_to_linear(x):
	return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def apple_gainmap_to_ultrahdr(gm: Image.Image, headroom: float):
	"""Re-express an Apple HDR gain map (linear-ish boost 1..headroom) as an Ultra HDR log2 map."""
	g = _srgb_to_linear(np.asarray(gm.convert('L'), dtype=np.float64) / 255.0)
	recovery = 1.0 + (headroom - 1.0) * g
	enc = np.log2(recovery) / np.log2(headroom)
	arr = np.clip(np.round(enc * 255.0), 0, 255).astype(np.uint8)
	return Image.fromarray(arr, 'L'), {
		'GainMapMin': 0.0, 'GainMapMax': float(np.log2(headroom)), 'Gamma': 1.0,
		'OffsetSDR': 0.0, 'OffsetHDR': 0.0, 'HDRCapacityMin': 0.0, 'HDRCapacityMax': float(np.log2(headroom)),
	}


def jpeg_q95(img, prof):
	buf = io.BytesIO()
	kw = {'quality': 95, 'subsampling': 0, 'optimize': True}
	if prof:
		kw['icc_profile'] = prof
	img.save(buf, 'JPEG', **kw)
	return buf.getvalue()


def full_from_heic(path: Path, img, prof, headroom):
	"""HEIC -> JPEG q95 4:4:4 (Ultra HDR when the gain map can be carried). Returns (bytes, info)."""
	primary = jpeg_q95(img, prof)
	info = {'orientation': 1, 'hdr': False, 'hdr_note': None}
	hf = pillow_heif.open_heif(path)
	aux = (hf[0].info.get('aux') or {}).get(APPLE_GAINMAP) or []
	other_hdr = [k for k in (hf[0].info.get('aux') or {}) if 'hdrgainmap' in k.lower() and k != APPLE_GAINMAP]
	if not aux:
		if other_hdr:
			info['hdr_note'] = f'gain map type {other_hdr[0]} not supported, published as SDR'
		out, _ = jpeg.strip(primary, ARTIST, COPYRIGHT)
		return out, info
	if headroom is None or headroom <= 1.0:
		info['hdr_note'] = 'HDR gain map present but no Apple headroom maker notes, published as SDR'
		out, _ = jpeg.strip(primary, ARTIST, COPYRIGHT)
		return out, info
	gm = hf[0].get_aux_image(aux[0]).to_pillow()
	ra, rb = img.size[0] / img.size[1], gm.size[0] / gm.size[1]
	if abs(ra - rb) / ra > 0.02:
		info['hdr_note'] = f'gain map {gm.size} does not match the photo orientation {img.size}, published as SDR'
		out, _ = jpeg.strip(primary, ARTIST, COPYRIGHT)
		return out, info
	gmap, params = apple_gainmap_to_ultrahdr(gm, headroom)
	buf = io.BytesIO()
	gmap.save(buf, 'JPEG', quality=90)
	out = jpeg.make_ultrahdr(primary, buf.getvalue(), params, ARTIST, COPYRIGHT)
	info['hdr'] = True
	return out, info
