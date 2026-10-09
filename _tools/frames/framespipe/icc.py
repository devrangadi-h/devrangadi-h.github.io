"""Tiny ICC v2 matrix/TRC profile writer (Display P3), for HEICs that signal P3 via nclx only."""
import struct

import numpy as np

D50 = np.array([0.9642, 1.0, 0.8249])


def _xy_to_xyz(x, y):
	return np.array([x / y, 1.0, (1 - x - y) / y])


def _rgb_to_xyz(prims, white):
	m = np.stack([_xy_to_xyz(*p) for p in prims], axis=1)
	s = np.linalg.solve(m, _xy_to_xyz(*white))
	return m * s


def _bradford(src_white_xyz, dst_white_xyz):
	b = np.array([[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]])
	s, d = b @ src_white_xyz, b @ dst_white_xyz
	return np.linalg.inv(b) @ np.diag(d / s) @ b


def _s15(v):
	return struct.pack('>i', int(round(v * 65536)))


def _xyz_tag(xyz):
	return b'XYZ \x00\x00\x00\x00' + b''.join(_s15(v) for v in xyz)


def _srgb_curve(n=1024):
	x = np.linspace(0, 1, n)
	y = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
	return b'curv\x00\x00\x00\x00' + struct.pack('>I', n) + b''.join(struct.pack('>H', int(round(v * 65535))) for v in y)


def _desc(text):
	a = text.encode('ascii') + b'\x00'
	return b'desc\x00\x00\x00\x00' + struct.pack('>I', len(a)) + a + b'\x00' * 4 + b'\x00' * 4 + b'\x00' * 3 + b'\x00' * 67


def display_p3() -> bytes:
	white = (0.3127, 0.3290)
	m = _rgb_to_xyz([(0.680, 0.320), (0.265, 0.690), (0.150, 0.060)], white)
	m = _bradford(_xy_to_xyz(*white), D50) @ m
	curve = _srgb_curve()
	tags = [
		(b'desc', _desc('Display P3')),
		(b'cprt', b'text\x00\x00\x00\x00No copyright, use freely\x00'),
		(b'wtpt', _xyz_tag(D50)),
		(b'rXYZ', _xyz_tag(m[:, 0])),
		(b'gXYZ', _xyz_tag(m[:, 1])),
		(b'bXYZ', _xyz_tag(m[:, 2])),
		(b'rTRC', curve), (b'gTRC', curve), (b'bTRC', curve),
	]
	off = 128 + 4 + 12 * len(tags)
	table, blob, seen = b'', b'', {}
	for sig, data in tags:
		if data in seen:
			o = seen[data]
		else:
			while (off + len(blob)) % 4:
				blob += b'\x00'
			o = off + len(blob)
			seen[data] = o
			blob += data
		table += sig + struct.pack('>II', o, len(data))
	body = struct.pack('>I', len(tags)) + table + blob
	size = 128 + len(body)
	hdr = struct.pack('>I', size) + b'\x00' * 4 + struct.pack('>I', 0x02100000) + b'mntrRGB XYZ '
	hdr += struct.pack('>6H', 2024, 1, 1, 0, 0, 0) + b'acsp' + b'\x00' * 4 + b'\x00' * 4 + b'\x00' * 8 + b'\x00' * 8
	hdr += struct.pack('>I', 0) + b''.join(_s15(v) for v in D50) + b'\x00' * 4
	hdr = hdr.ljust(128, b'\x00')
	return hdr + body
