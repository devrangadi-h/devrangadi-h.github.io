"""Clip processing with ffmpeg: silent H.264 loop, long edge <= 1280, <= ~3 MB, poster frame."""
import io
import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

MAX_SECONDS = 10.5
TARGET_BYTES = 3 * 1024 * 1024


def probe(path: Path):
	r = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', str(path)], capture_output=True, text=True)
	if r.returncode != 0:
		raise ValueError(f'ffprobe cannot read it: {r.stderr.strip()[:200]}')
	d = json.loads(r.stdout)
	v = next((s for s in d.get('streams', []) if s.get('codec_type') == 'video'), None)
	if not v:
		raise ValueError('no video stream')
	dur = float(v.get('duration') or d.get('format', {}).get('duration') or 0)
	return {'duration': dur, 'width': int(v['width']), 'height': int(v['height']), 'transfer': v.get('color_transfer'), 'pix_fmt': v.get('pix_fmt')}


def _vf(info):
	f = []
	if info.get('transfer') in ('arib-std-b67', 'smpte2084'):
		# HLG/PQ (iPhone HDR video) -> SDR BT.709 so it doesn't look washed out
		f.append('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv')
	f.append("scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))':flags=lanczos")
	f.append('scale=trunc(iw/2)*2:trunc(ih/2)*2')
	f.append('format=yuv420p')
	return ','.join(f)


def _encode(src, dst, vf, extra, passlog=None):
	cmd = ['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-map', '0:v:0', '-an', '-sn', '-dn',
		'-map_metadata', '-1', '-map_chapters', '-1', '-vf', vf, '-c:v', 'libx264', '-preset', 'slow',
		'-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709',
		'-colorspace', 'bt709', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact',
		*extra]
	if passlog:
		cmd += ['-passlogfile', passlog]
	cmd.append(str(dst))
	r = subprocess.run(cmd, capture_output=True, text=True)
	if r.returncode != 0:
		raise RuntimeError(f'ffmpeg failed for {src}: {r.stderr.strip()[-400:]}')


def process(src: Path):
	"""Returns (mp4_bytes, poster_webp_bytes, width, height, duration)."""
	info = probe(src)
	vf = _vf(info)
	with tempfile.TemporaryDirectory() as td:
		out = Path(td) / 'out.mp4'
		_encode(src, out, vf, ['-crf', '22'])
		if out.stat().st_size > TARGET_BYTES:
			kbps = int(TARGET_BYTES * 8 * 0.94 / max(info['duration'], 0.5) / 1000)
			log = str(Path(td) / 'pass')
			_encode(src, Path(td) / 'null.mp4', vf, ['-b:v', f'{kbps}k', '-pass', '1'], log)
			_encode(src, out, vf, ['-b:v', f'{kbps}k', '-maxrate', f'{int(kbps * 1.5)}k', '-bufsize', f'{kbps * 2}k', '-pass', '2'], log)
		mp4 = out.read_bytes()
		o = probe(out)
		r = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(out), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True)
		if r.returncode != 0:
			raise RuntimeError(f'poster extraction failed for {src}')
	img = Image.open(io.BytesIO(r.stdout)).convert('RGB')
	buf = io.BytesIO()
	img.save(buf, 'WEBP', quality=85, method=6)
	return mp4, buf.getvalue(), o['width'], o['height'], o['duration']
