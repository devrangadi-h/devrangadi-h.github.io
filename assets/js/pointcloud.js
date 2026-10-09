// Homepage point cloud: LiDAR terrain with a scan sweep that morphs into project shapes.
// Hooks: [data-pointcloud] canvas, [data-hero], [data-shape]; sets html.pc-ready / html.pc-static.
// Egg: window.site.pointcloud.egg (homepage) or mount(canvas) for a bare instance elsewhere.
import * as THREE from '../vendor/three.module.min.js';

const root = document.documentElement;
const homeCanvas = document.querySelector('[data-pointcloud]');
const debug = new URLSearchParams(location.search).get('pc');
const site = window.site || {};
const reduced = () => (site.reducedMotion ? site.reducedMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches);
const TOUCH = site.isTouch ?? matchMedia('(hover: none)').matches;
const N = TOUCH ? 4000 : 15000;
const C = new THREE.Vector3(0, 0.15, 0); // shape centre / look target
THREE.ColorManagement.enabled = false; // token hex -> shader as-is

let stop = () => {};
// Fallback image: never let a missing/broken file show an icon.
const fallback = document.querySelector('.pc-fallback');
if (fallback) {
	const drop = () => fallback.remove();
	if (fallback.complete && !fallback.naturalWidth) drop(); else fallback.addEventListener('error', drop);
}
// Only before the first frame (or on context loss / reduced motion): never for performance.
function giveUp() {
	root.classList.add('pc-static');
	root.classList.remove('pc-ready');
	stop();
	delete site.pointcloud;
}


// ---- deterministic random + noise ----
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 0.8;
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
	const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
	const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
	return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y) { let v = 0, a = 0.5; for (let i = 0; i < 4; i++) { v += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return v; }

// ---- shape building: weighted parts sampled to exactly N points ----
const seg = (a, b) => [Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), (u, v) => { v[0] = a[0] + (b[0] - a[0]) * u; v[1] = a[1] + (b[1] - a[1]) * u; v[2] = a[2] + (b[2] - a[2]) * u; }];
const ring = (cx, cy, cz, r) => [6.283 * r, (u, v) => { const t = u * 6.283; v[0] = cx + Math.cos(t) * r; v[1] = cy + Math.sin(t) * r; v[2] = cz; }];
const disk = (cx, cy, cz, r) => [3.14 * r * r * 2, (u, v, w) => { const t = u * 6.283, q = Math.sqrt(w) * r; v[0] = cx + Math.cos(t) * q; v[1] = cy + Math.sin(t) * q; v[2] = cz; }];
const rect = (x, y, z, w, h) => [w * h * 3, (u, v, w2) => { v[0] = x + u * w; v[1] = y + w2 * h; v[2] = z; }];
function outline(x, y, z, w, h) { return [seg([x, y, z], [x + w, y, z]), seg([x + w, y, z], [x + w, y + h, z]), seg([x + w, y + h, z], [x, y + h, z]), seg([x, y + h, z], [x, y, z])]; }
function boxEdges(cx, cy, cz, sx, sy, sz) {
	const out = [], h = [sx / 2, sy / 2, sz / 2];
	const p = (i) => [cx + (i & 1 ? h[0] : -h[0]), cy + (i & 2 ? h[1] : -h[1]), cz + (i & 4 ? h[2] : -h[2])];
	for (let i = 0; i < 8; i++) for (let b = 1; b < 8; b <<= 1) if (!(i & b)) out.push(seg(p(i), p(i | b)));
	return out;
}
// Points on the surface of a box (a LiDAR return cluster).
const boxSurf = (cx, cy, cz, sx, sy, sz) => [(sx * sy + sy * sz + sx * sz) * 2, (u, v, w) => {
	const f = Math.floor(u * 6), a = w * 2 - 1, b = rnd() * 2 - 1, s = f & 1 ? 1 : -1;
	const q = f < 2 ? [s, a, b] : f < 4 ? [a, s, b] : [a, b, s];
	v[0] = cx + q[0] * sx / 2; v[1] = cy + q[1] * sy / 2; v[2] = cz + q[2] * sz / 2;
}];
function scaleParts(parts, k) { return parts.map((p) => [p[0] * k, p[1]]); }
function build(parts, rot, jitter = 0.012) {
	const out = new Float32Array(N * 3), v = [0, 0, 0];
	const total = parts.reduce((s, p) => s + p[0], 0);
	let i = 0, cum = 0;
	parts.forEach((p) => {
		cum += p[0];
		const end = Math.round(N * cum / total);
		for (; i < end; i++) {
			p[1](rnd(), v, rnd());
			out[i * 3] = v[0] + gauss() * jitter; out[i * 3 + 1] = v[1] + gauss() * jitter; out[i * 3 + 2] = v[2] + gauss() * jitter;
		}
	});
	if (rot) {
		const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2] || 0));
		const t = new THREE.Vector3();
		for (let j = 0; j < N; j++) { t.fromArray(out, j * 3).applyMatrix4(m).add(C).toArray(out, j * 3); }
	}
	return shuffle(out);
}
function shuffle(a) {
	for (let i = N - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		for (let k = 0; k < 3; k++) { const t = a[i * 3 + k]; a[i * 3 + k] = a[j * 3 + k]; a[j * 3 + k] = t; }
	}
	return a;
}

function terrain(aspect) {
	const out = new Float32Array(N * 3);
	const rows = TOUCH ? 34 : 64, cols = Math.floor(N / rows), wf = 0.47 * Math.max(aspect, 0.7) * 1.25;
	let i = 0;
	for (let r = 0; r < rows; r++) {
		const d = 2.6 * Math.pow(36 / 2.6, r / (rows - 1));
		for (let c = 0; c < cols; c++, i++) {
			const x = ((c + rnd() * 0.3) / cols * 2 - 1) * (d * wf + 1.5), z = 6 - d;
			const y = -1.35 + (fbm(x * 0.15 + 3, z * 0.15) - 0.4) * (1.6 + d * 0.09) + Math.max(0, d - 14) * 0.05;
			out.set([x, y, z], i * 3);
		}
	}
	for (; i < N; i++) out.set([0, -50, 0], i * 3);
	return shuffle(out);
}

function shapes() {
	const S = {};
	// Detection: LiDAR returns from a car, a pedestrian and a second car, each in a 3D bounding box with a label tab.
	{
		const objs = [[-1.25, -0.6, 0.2, 2.1, 0.75, 1.0, 'car'], [1.15, -0.2, 0.6, 0.5, 1.55, 0.5, 'ped'], [2.0, -0.65, -1.6, 1.8, 0.7, 0.95, 'car']];
		const parts = [];
		objs.forEach(([x, y, z, sx, sy, sz, kind]) => {
			if (kind === 'car') {
				const b = y - sy / 2 + 0.14;
				parts.push(scaleParts([boxSurf(x, b + sy * 0.22, z, sx, sy * 0.45, sz * 0.9)], 2.2)[0]);
				parts.push(scaleParts([boxSurf(x - sx * 0.06, b + sy * 0.6, z, sx * 0.5, sy * 0.32, sz * 0.8)], 2.2)[0]);
				[-0.32, 0.32].forEach((fx) => [-1, 1].forEach((fz) => parts.push([0.5, (u, v) => { const t = u * 6.283; v[0] = x + fx * sx + Math.cos(t) * 0.14; v[1] = b + Math.sin(t) * 0.14; v[2] = z + fz * sz * 0.45; }])));
			} else {
				const leg = (dx) => seg([x + dx * 0.05, y - 0.05, z], [x + dx * 0.16, y - sy / 2, z]);
				parts.push(...scaleParts([leg(-1), leg(1), seg([x, y - 0.05, z], [x, y + 0.5, z]), seg([x - 0.22, y + 0.05, z], [x, y + 0.45, z]), seg([x + 0.22, y + 0.05, z], [x, y + 0.45, z])], 3));
				parts.push([2, (u, v, w) => { const t = u * 6.283, p = Math.acos(w * 2 - 1); v[0] = x + Math.sin(p) * Math.cos(t) * 0.13; v[1] = y + 0.64 + Math.cos(p) * 0.13; v[2] = z + Math.sin(p) * Math.sin(t) * 0.13; }]);
			}
			const bx = sx * 1.12, by = sy * 1.1, bz = sz * 1.15;
			parts.push(...scaleParts(boxEdges(x, y, z, bx, by, bz), 2.2));
			parts.push(rect(x - bx / 2, y + by / 2, z + bz / 2, Math.min(0.85, bx * 0.9), 0.18));
		});
		S.detection = build(parts, [0.32, -0.55]);
	}
	// Eclipse: hexacopter seen from above — hub, 6 arms, motor pods and rotor rings with blades.
	{
		const parts = [], R = 1.3, rr = 0.5;
		parts.push(scaleParts([disk(0, 0, 0, 0.4)], 1.5)[0], scaleParts([ring(0, 0, 0, 0.42)], 2.5)[0], scaleParts([ring(0, 0, 0.03, 0.22)], 2)[0]);
		for (let k = 0; k < 6; k++) {
			const a = k / 6 * 6.283 + 0.5236, cx = Math.cos(a) * R, cy = Math.sin(a) * R, nx = -Math.sin(a) * 0.04, ny = Math.cos(a) * 0.04;
			parts.push(scaleParts([seg([Math.cos(a) * 0.42 + nx, Math.sin(a) * 0.42 + ny, 0], [cx + nx, cy + ny, 0])], 2.5)[0]);
			parts.push(scaleParts([seg([Math.cos(a) * 0.42 - nx, Math.sin(a) * 0.42 - ny, 0], [cx - nx, cy - ny, 0])], 2.5)[0]);
			parts.push(scaleParts([ring(cx, cy, 0.05, rr)], 2.4)[0], scaleParts([ring(cx, cy, 0.05, rr * 0.93)], 1.2)[0]);
			parts.push(scaleParts([disk(cx, cy, 0.02, 0.1)], 3)[0]);
			const b = k * 1.1;
			parts.push(scaleParts([seg([cx - Math.cos(b) * rr * 0.85, cy - Math.sin(b) * rr * 0.85, 0.08], [cx + Math.cos(b) * rr * 0.85, cy + Math.sin(b) * rr * 0.85, 0.08])], 1.5)[0]);
		}
		S.eclipse = build(parts, [-0.62, 0.15, 0.12]);
	}
	// Flow: streamlines of potential flow past a cylinder, with chevrons showing direction.
	{
		const parts = [], R = 0.55, lines = [];
		const vel = (x, y) => { const r2 = x * x + y * y, r4 = r2 * r2; return [1 - R * R * (x * x - y * y) / r4, -2 * R * R * x * y / r4]; };
		for (let k = 0; k < 15; k++) {
			let y = -1.45 + k * (2.9 / 14), x = -2.8;
			if (Math.abs(y) < 0.02) y = 0.04;
			const pts = [[x, y]];
			for (let s = 0; s < 400 && x < 2.8; s++) { const v = vel(x, y), m = Math.hypot(v[0], v[1]) || 1; x += v[0] / m * 0.015; y += v[1] / m * 0.015; pts.push([x, y]); }
			lines.push(pts);
		}
		lines.forEach((pts, k) => {
			for (let j = 1; j < pts.length; j++) parts.push(seg([pts[j - 1][0], pts[j - 1][1], 0], [pts[j][0], pts[j][1], 0]));
			for (let j = 40 + (k % 2) * 20; j < pts.length - 2; j += 70) {
				const [x, y] = pts[j], dx = pts[j + 1][0] - x, dy = pts[j + 1][1] - y, m = Math.hypot(dx, dy), ux = dx / m, uy = dy / m;
				parts.push(scaleParts([seg([x, y, 0], [x - ux * 0.13 + uy * 0.08, y - uy * 0.13 - ux * 0.08, 0])], 1.6)[0]);
				parts.push(scaleParts([seg([x, y, 0], [x - ux * 0.13 - uy * 0.08, y - uy * 0.13 + ux * 0.08, 0])], 1.6)[0]);
			}
		});
		parts.push(scaleParts([ring(0, 0, 0, R)], 3)[0], scaleParts([disk(0, 0, 0, R * 0.95)], 0.25)[0]);
		S.flow = build(parts, [-0.35, 0], 0.01);
	}
	// Polaris: Raspberry Pi board — outline, mounting holes, 40-pin header, SoC, RAM, USB/Ethernet and HDMI ports.
	{
		const k = 0.043, W = 85 * k, H = 56 * k, x0 = -W / 2, y0 = -H / 2, parts = [];
		const box3 = (x, y, w, h, d) => [...scaleParts(boxEdges(x + w / 2, y + h / 2, d / 2, w, h, d), 2.2), [w * h * 2, (u, v, w2) => { v[0] = x + u * w; v[1] = y + w2 * h; v[2] = d; }]];
		parts.push(...scaleParts(outline(x0, y0, 0, W, H), 3), [W * H * 0.35, (u, v, w) => { v[0] = x0 + u * W; v[1] = y0 + w * H; v[2] = 0; }]);
		[[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]].forEach(([x, y]) => parts.push(scaleParts([ring(x0 + x * k, y0 + y * k, 0, 0.1)], 2)[0]));
		for (let c = 0; c < 20; c++) for (let r = 0; r < 2; r++) parts.push([0.12, (u, v, w) => { v[0] = x0 + (8 + c * 2.54) * k + (u - 0.5) * 0.05; v[1] = y0 + (50 + r * 2.54) * k + (w - 0.5) * 0.05; v[2] = 0.12; }]);
		parts.push(...scaleParts(outline(x0 + 6.5 * k, y0 + 48.3 * k, 0.06, 51.5 * k, 6 * k), 1.5));
		parts.push(...box3(x0 + 22 * k, y0 + 22 * k, 15 * k, 15 * k, 0.07));
		parts.push(...box3(x0 + 40 * k, y0 + 24 * k, 10 * k, 12 * k, 0.05));
		parts.push(...box3(x0 + 70 * k, y0 + 2 * k, 21 * k, 16 * k, 0.5)); // ethernet
		parts.push(...box3(x0 + 70 * k, y0 + 20.5 * k, 17 * k, 13 * k, 0.6)); // usb
		parts.push(...box3(x0 + 70 * k, y0 + 38.5 * k, 17 * k, 13 * k, 0.6)); // usb
		[[11.2, 9], [26, 7], [39.5, 7]].forEach(([x, w]) => parts.push(...box3(x0 + (x - w / 2) * k, y0 - 1.5 * k, w * k, 7.5 * k, 0.12)));
		parts.push(scaleParts([ring(x0 + 54 * k, y0 + 3 * k, 0.15, 0.13)], 2)[0]);
		S.polaris = build(parts, [-0.68, 0.18]);
	}
	// Research: an atmospheric-sounding UAV climbing a helical path above a launch pad, waypoints along the way.
	{
		const parts = [], turns = 3.25, R = 1.05, y0 = -1.35, y1 = 1.2;
		const helix = (t) => { const a = t * turns * 6.283; return [Math.cos(a) * R, y0 + 0.15 + t * (y1 - y0 - 0.3), Math.sin(a) * R]; };
		for (let j = 0; j < 200; j++) parts.push(scaleParts([seg(helix(j / 200), helix((j + 1) / 200))], 2.2)[0]);
		for (let j = 1; j < 13; j++) { const p = helix(j / 13); parts.push([0.6, (u, v, w) => { const t = u * 6.283; v[0] = p[0] + Math.cos(t) * 0.09; v[1] = p[1] + Math.sin(t) * 0.09; v[2] = p[2] + (w - 0.5) * 0.02; }]); }
		parts.push([R * 2, (u, v) => { v[0] = 0; v[1] = y0 + u * (y1 - y0 + 0.2); v[2] = 0; }]);
		for (let j = 0; j <= 6; j++) parts.push(seg([-0.1, y0 + j * 0.45, 0], [0.1, y0 + j * 0.45, 0]));
		parts.push([12, (u, v) => { const t = u * 6.283; v[0] = Math.cos(t) * 1.45; v[1] = y0; v[2] = Math.sin(t) * 1.45; }]);
		parts.push([2, (u, v) => { const t = u * 6.283; v[0] = Math.cos(t) * 0.35; v[1] = y0; v[2] = Math.sin(t) * 0.35; }]);
		const top = helix(1);
		for (let k = 0; k < 4; k++) {
			const a = k * 1.5708 + 0.785, ex = top[0] + Math.cos(a) * 0.32, ez = top[2] + Math.sin(a) * 0.32;
			parts.push(scaleParts([seg(top, [ex, top[1], ez])], 2)[0]);
			parts.push([1.2, (u, v) => { const t = u * 6.283; v[0] = ex + Math.cos(t) * 0.15; v[1] = top[1] + 0.03; v[2] = ez + Math.sin(t) * 0.15; }]);
		}
		S.research = build(parts, [0.3, 0]);
	}
	return Object.assign(S, HEART || (HEART = heart()));
}

// Heart (and the dust it dissolves into), the only shapes a bare instance needs.
let HEART = null;
function heart() {
	const S = {};
	// Heart: arc-length outline, an inner contour and a pillowy fill (rejection-sampled), tilted to face the camera.
	{
		const k = 0.1, P = [], L = [0];
		for (let j = 0; j <= 400; j++) {
			const t = j / 400 * 6.2832;
			P.push([16 * Math.pow(Math.sin(t), 3) * k, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) * k]);
			if (j) L.push(L[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]));
		}
		const along = (u, v, s, dy) => {
			const d = u * L[400]; let j = 1;
			while (L[j] < d) j++;
			const f = (d - L[j - 1]) / (L[j] - L[j - 1] || 1);
			v[0] = (P[j - 1][0] + (P[j][0] - P[j - 1][0]) * f) * s; v[1] = (P[j - 1][1] + (P[j][1] - P[j - 1][1]) * f) * s + dy; v[2] = 0;
		};
		const inside = (x, y) => { let c = false; for (let a = 0, b = 399; a < 400; b = a++) if ((P[a][1] > y) !== (P[b][1] > y) && x < (P[b][0] - P[a][0]) * (y - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) c = !c; return c; };
		const edge = (x, y) => { let m = 9; for (let a = 0; a < 400; a += 4) m = Math.min(m, Math.hypot(P[a][0] - x, P[a][1] - y)); return m; };
		const parts = [[11, (u, v) => along(u, v, 1, 0)], [4, (u, v) => along(u, v, 0.86, 0.02)],
			[30, (u, v) => {
				let x, y;
				do { x = (rnd() * 2 - 1) * 1.6; y = rnd() * 2.95 - 1.48; } while (!inside(x, y));
				v[0] = x; v[1] = y; v[2] = Math.sqrt(Math.min(1, edge(x, y) / 0.7)) * (rnd() < 0.5 ? -0.3 : 0.3);
			}]];
		S.heart = build(parts, [-0.21, 0], 0.014);
		S.dust = new Float32Array(S.heart.length);
		for (let i = 0; i < S.dust.length; i++) S.dust[i] = C.getComponent(i % 3) + (S.heart[i] - C.getComponent(i % 3)) * 2.6 + gauss() * 1.4;
	}
	return S;
}

let SHAPES = null;
// bare: egg-only instance (no terrain, hover or touch cycle); starts as an unlit spark at the centre.
function init(canvas, bare) {
	const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!debug });
	renderer.setClearColor(0x000000, 0);
	const dpr = Math.min(devicePixelRatio || 1, TOUCH ? 1 : 1.5);
	renderer.setPixelRatio(dpr);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
	const camBase = new THREE.Vector3(0, 1.5, 6.2);

	const size = () => [canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight];
	let [w, h] = size();
	const shapeScale = () => Math.min(1, Math.max(0.42, (w / h) / 1.45));
	const S = Object.assign({}, bare ? HEART || (HEART = heart()) : SHAPES || (SHAPES = shapes()));
	if (!bare) S.terrain = terrain(w / h);
	if (bare) { S.spark = new Float32Array(N * 3); for (let i = 0; i < S.spark.length; i++) S.spark[i] = C.getComponent(i % 3) + gauss() * 0.08; }
	const scaled = (key) => {
		const src = S[key], s = key === 'terrain' || key === 'spark' ? 1 : key === 'heart' || key === 'dust' ? Math.min(1, w / h * 1.3) : shapeScale();
		if (s === 1) return src;
		const out = new Float32Array(src.length);
		for (let i = 0; i < src.length; i += 3) { out[i] = C.x + (src[i] - C.x) * s; out[i + 1] = C.y + (src[i + 1] - C.y) * s; out[i + 2] = C.z + (src[i + 2] - C.z) * s; }
		return out;
	};

	const geo = new THREE.BufferGeometry();
	const start = bare ? S.spark : S.terrain;
	const pos = new Float32Array(start), tgt = new Float32Array(start), rndA = new Float32Array(N * 3);
	for (let i = 0; i < rndA.length; i++) rndA[i] = rnd();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('aTarget', new THREE.BufferAttribute(tgt, 3));
	geo.setAttribute('aRnd', new THREE.BufferAttribute(rndA, 3));
	geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);

	const U = {
		uMorph: { value: 0 }, uTime: { value: 0 }, uScanR: { value: 0 }, uScanAmt: { value: 1 },
		uPx: { value: dpr }, uSize: { value: 2.2 }, uBright: { value: 1 }, uPush: { value: 0 }, uAspect: { value: 1 },
		uMouse: { value: new THREE.Vector2(9, 9) }, uColor: { value: new THREE.Color() }, uHi: { value: new THREE.Color() }, uLight: { value: 0 },
		uBurst: { value: 0 }, uBeat: { value: 1 }, uWarm: { value: 0 }, uRose: { value: new THREE.Color() }, uC: { value: C }
	};
	const mat = new THREE.ShaderMaterial({
		uniforms: U, transparent: true, depthTest: false, depthWrite: false,
		vertexShader: `
attribute vec3 aTarget; attribute vec3 aRnd;
uniform float uMorph, uTime, uScanR, uScanAmt, uPx, uSize, uBright, uPush, uAspect, uLight, uBurst, uBeat;
uniform vec2 uMouse; uniform vec3 uC;
varying float vA; varying float vHi;
void main() {
	vec3 p = mix(position, aTarget, uMorph);
	float sm = sin(uMorph * 3.14159);
	p += (aRnd - 0.5) * sm * (0.9 + uBurst * 1.6) + normalize(p - uC + 1e-4) * sm * uBurst * 1.4;
	p = uC + (p - uC) * uBeat;
	vec4 mv = modelViewMatrix * vec4(p, 1.0);
	float d = -mv.z;
	gl_Position = projectionMatrix * mv;
	vec2 dv = gl_Position.xy / gl_Position.w - uMouse; dv.x *= uAspect;
	float f = uPush * smoothstep(0.3, 0.0, length(dv));
	gl_Position.xy += normalize(dv + 1e-5) * vec2(1.0 / uAspect, 1.0) * f * 0.07 * gl_Position.w;
	float s = ((6.0 - p.z) - uScanR) / (uScanR * 0.03);
	float hi = (exp(-s * s) + (s < 0.0 ? exp(s * 0.12) * 0.28 : 0.0)) * uScanAmt;
	vHi = hi;
	float fade = clamp(1.25 - d / 26.0, 0.0, 1.0);
	vA = (fade * fade * mix(1.0, 0.72 + 0.12 * sin(uTime * 1.3 + aRnd.x * 40.0), uScanAmt) + hi * max(fade, 0.4) * 0.9) * uBright;
	gl_PointSize = min(uSize * uPx * (0.7 + aRnd.y * 0.6) * (6.0 / d) * (1.0 + vHi * 0.7), 9.0 * uPx);
}`,
		fragmentShader: `
uniform vec3 uColor, uHi, uRose; uniform float uLight, uWarm;
varying float vA; varying float vHi;
void main() {
	vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
	if (d > 0.25) discard;
	float a = smoothstep(0.25, mix(0.04, 0.12, uLight), d) * vA;
	gl_FragColor = vec4(mix(mix(uColor, uHi, clamp(vHi, 0.0, 1.0)), uRose, uWarm), min(a, 1.0));
}`
	});
	const points = new THREE.Points(geo, mat);
	points.frustumCulled = false;
	scene.add(points);

	// Theme colours from tokens; additive glow on dark, normal alpha on light.
	const cx = document.createElement('canvas').getContext('2d');
	const tok = (name, fb) => { cx.fillStyle = fb; cx.fillStyle = getComputedStyle(root).getPropertyValue(name).trim() || fb; return cx.fillStyle; };
	function theme() {
		const dark = (site.theme ? site.theme() : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
		U.uColor.value.set(tok('--points', '#38bdf8'));
		U.uHi.value.set(tok('--accent-strong', '#bae6fd'));
		U.uRose.value.set(dark ? '#fb7185' : '#e11d48');
		U.uLight.value = dark ? 0 : 1;
		U.uSize.value = dark ? 2.2 : 2.6;
		mat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
		mat.needsUpdate = true;
	}
	theme();
	document.addEventListener('themechange', theme);

	// ---- tweens (advanced inside the render loop) ----
	const tweens = new Map();
	const expo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
	function tween(key, to, dur, done) {
		const from = state[key];
		if (from === to) { tweens.delete(key); return; }
		tweens.set(key, { from, to, t0: performance.now(), dur, done });
	}
	const state = { morph: 0, bright: bare ? 0 : 1, push: 0, scanFrom: 1, scanTo: 1, burst: 0, warm: 0 };
	function stepTweens(now) {
		tweens.forEach((tw, key) => {
			const t = Math.min(1, (now - tw.t0) / tw.dur);
			state[key] = tw.from + (tw.to - tw.from) * expo(t);
			if (t >= 1) { tweens.delete(key); tw.done && tw.done(); }
		});
	}

	// ---- morphing ----
	let active = bare ? 'spark' : 'terrain';
	function morphTo(key, dur = 1400) {
		if (!S[key]) key = 'terrain';
		if (key === active && !tweens.has('morph')) return;
		const m = state.morph, sm = Math.sin(m * Math.PI), k = sm * (0.9 + state.burst * 1.6), kr = sm * state.burst * 1.4;
		if (m > 0) for (let i = 0; i < pos.length; i += 3) {
			const x = pos[i] + (tgt[i] - pos[i]) * m - C.x, y = pos[i + 1] + (tgt[i + 1] - pos[i + 1]) * m - C.y, z = pos[i + 2] + (tgt[i + 2] - pos[i + 2]) * m - C.z;
			const r = kr / (Math.hypot(x, y, z) || 1);
			pos[i] = C.x + x + x * r + (rndA[i] - 0.5) * k; pos[i + 1] = C.y + y + y * r + (rndA[i + 1] - 0.5) * k; pos[i + 2] = C.z + z + z * r + (rndA[i + 2] - 0.5) * k;
		}
		tgt.set(scaled(key));
		geo.attributes.position.needsUpdate = geo.attributes.aTarget.needsUpdate = true;
		state.scanFrom = state.scanFrom + (state.scanTo - state.scanFrom) * m;
		state.scanTo = key === 'terrain' && !bare ? 1 : 0;
		state.morph = 0;
		active = key;
		tween('morph', 1, dur, () => {
			pos.set(tgt); state.morph = 0; state.scanFrom = state.scanTo;
			if (!egg) state.burst = 0;
			geo.attributes.position.needsUpdate = true;
		});
	}

	// ---- state: hero visibility, hovered shape, touch cycle ----
	const hero = document.querySelector('[data-hero]');
	let heroVisible = true, hoverKey = null, cycleKey = null, leaveT = 0, egg = false, beatT0 = 0;
	function apply(dur) {
		if (egg) return;
		if (bare) { updateRunning(); return; }
		const key = hoverKey || (TOUCH && cycleKey) || 'terrain';
		if (key !== active) morphTo(key, dur);
		tween('bright', hoverKey ? 0.45 : heroVisible ? 1 : 0.25, dur || 900);
		updateRunning();
	}
	if (hero && !bare && 'IntersectionObserver' in window) {
		new IntersectionObserver((es) => { heroVisible = es[0].intersectionRatio > 0.35; apply(); }, { threshold: [0, 0.35, 0.6] }).observe(hero);
	}
	if (!TOUCH && !bare) {
		const shapeOf = (el) => el && el.closest && el.closest('[data-shape]');
		const enter = (ev) => {
			if (ev.pointerType === 'touch') return;
			const el = shapeOf(ev.target);
			if (!el) return;
			clearTimeout(leaveT);
			if (hoverKey !== el.dataset.shape) { hoverKey = el.dataset.shape; apply(); }
		};
		const leave = (ev) => {
			const el = shapeOf(ev.target);
			if (!el || el.contains(ev.relatedTarget)) return;
			clearTimeout(leaveT);
			leaveT = setTimeout(() => { hoverKey = null; apply(); }, 120);
		};
		document.addEventListener('pointerover', enter);
		document.addEventListener('pointerout', leave);
		document.addEventListener('focusin', enter);
		document.addEventListener('focusout', leave);
	}
	let cycleI = 0, cycleT = 0;
	const cycleOrder = ['detection', 'eclipse', 'flow', 'polaris', 'research'];

	// ---- pointer: parallax + push ----
	const mouse = new THREE.Vector2(9, 9), par = new THREE.Vector2(), parT = new THREE.Vector2();
	if (!TOUCH && !bare) {
		addEventListener('pointermove', (ev) => {
			if (ev.pointerType === 'touch') return;
			mouse.set(ev.clientX / innerWidth * 2 - 1, 1 - ev.clientY / innerHeight * 2);
			parT.copy(mouse);
			if (state.push !== 1 && !tweens.has('push')) tween('push', 1, 600);
		}, { passive: true });
		document.addEventListener('pointerleave', () => { parT.set(0, 0); tween('push', 0, 600); });
	}

	// ---- sizing ----
	function resize() {
		[w, h] = size();
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		U.uAspect.value = w / h;
		if (active !== 'terrain' && active !== 'spark') { const k = active; active = ''; morphTo(k, 500); }
	}
	resize();
	let rt = 0;
	const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 150); };
	addEventListener('resize', onResize);

	// ---- loop, perf guard, pausing ----
	// Degradation levels: 1 half points, 2 DPR 1, 3 cap 30 fps, 4 no cursor push / scan glow.
	let raf = 0, last = 0, onScreen = true, frames = [], level = 0, first = true;
	function setLevel(n, med) {
		level = n;
		if (n === 1) geo.setDrawRange(0, N >> 1);
		if (n === 2) { renderer.setPixelRatio(1); U.uPx.value = 1; resize(); }
		if (bare) return;
		root.dataset.pcLevel = n;
		console.info('pointcloud: level ' + n + ' (median frame ' + med.toFixed(1) + ' ms)');
	}
	if (!bare) root.dataset.pcLevel = 0;
	const t0 = performance.now();
	const force = debug === 'force';
	function frame(now) {
		raf = requestAnimationFrame(frame);
		if (level >= 3 && last && now - last < 30) return;
		const dt = last ? now - last : 16;
		last = now;
		stepTweens(now);
		const t = (now - t0) / 1000;
		if (TOUCH && !bare && !egg && t > cycleT) {
			cycleT = t + 6;
			cycleKey = cycleKey ? null : cycleOrder[cycleI++ % cycleOrder.length];
			apply();
		}
		par.lerp(parT, Math.min(1, dt / 400));
		camera.position.set(camBase.x + par.x * 0.45 + Math.sin(t * 0.13) * 0.2, camBase.y + par.y * 0.22, camBase.z);
		camera.lookAt(C);
		U.uTime.value = t;
		U.uMorph.value = state.morph;
		U.uBright.value = state.bright;
		U.uPush.value = level >= 4 ? 0 : state.push;
		U.uMouse.value.copy(mouse);
		U.uScanAmt.value = level >= 4 ? 0 : state.scanFrom + (state.scanTo - state.scanFrom) * state.morph;
		U.uScanR.value = 2.4 * Math.pow(17, (t / 4) % 1); // geometric: even speed on screen
		U.uBurst.value = state.burst;
		U.uWarm.value = state.warm;
		// Lub-dub at 1 Hz: two soft scale bumps per beat, two beats.
		const bt = beatT0 ? (now - beatT0) / 1000 : 9, ph = bt % 1;
		const beat = bt < 2 ? Math.exp(-Math.pow((ph - 0.12) / 0.08, 2)) * 0.075 + Math.exp(-Math.pow((ph - 0.4) / 0.09, 2)) * 0.045 : 0;
		U.uBeat.value = 1 + beat;
		U.uBright.value = state.bright * (1 + beat * 1.5);
		renderer.render(scene, camera);
		if (first) { first = false; if (!bare) root.classList.add('pc-ready'); }
		// Perf guard: median over 60 frames; step down one level per slow window, never off.
		if (!force && level < 4 && frames && dt < 1000) {
			frames.push(dt);
			if (frames.length === 70) {
				const med = frames.slice(10).sort((a, b) => a - b)[30];
				if (med > (level >= 3 ? 40 : 28)) {
					// Level 2 (DPR 1) is a no-op on 1x screens, so go straight to the fps cap
					const next = level === 1 && renderer.getPixelRatio() === 1 ? 3 : level + 1;
					setLevel(next, med); frames = [];
				} else frames = null;
			}
		}
		if (debug) stats.push(dt);
	}
	const stats = [];
	function updateRunning() {
		const run = egg || bare || (!document.hidden && onScreen && (!TOUCH || heroVisible));
		if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
		else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
	}
	const dispose = () => { cancelAnimationFrame(raf); raf = 1e9; renderer.dispose(); geo.dispose(); mat.dispose(); };
	const api = {};
	if (bare) {
		canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); api.lost = true; });
		api.destroy = () => { dispose(); removeEventListener('resize', onResize); document.removeEventListener('themechange', theme); };
	} else {
		document.addEventListener('visibilitychange', updateRunning);
		if ('IntersectionObserver' in window) new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; updateRunning(); }).observe(canvas);
		canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); giveUp(); });
		matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { if (e.matches) giveUp(); });
		stop = dispose;
	}
	// Egg: heart() bursts the current points into a rose heart, beat() pulses it twice,
	// release(ms) sends it back (homepage: to whatever apply() wants; bare: drifts out and fades).
	api.egg = {
		heart(dur = 1900) {
			egg = true; beatT0 = 0; clearTimeout(leaveT);
			state.burst = 1;
			tween('push', 0, 400);
			tween('warm', 1, 1200);
			tween('bright', U.uLight.value ? 1 : 0.6, bare ? 700 : 900); // additive glow saturates on dark
			morphTo('heart', dur);
			updateRunning();
		},
		beat() { beatT0 = performance.now(); },
		release(dur = 1600) {
			egg = false; beatT0 = 0;
			tween('warm', 0, dur * 1.2);
			// Set burst after the morph starts so the interrupted morph bakes with the old value.
			if (bare) { morphTo('dust', dur * 1.4); tween('bright', 0, dur); state.burst = 0.5; return; }
			active = '';
			apply(dur);
			state.burst = 0.6;
		}
	};
	updateRunning();

	if (debug && !bare) window.__pc = {
		morph: (k) => { hoverKey = k === 'terrain' ? null : k; apply(); },
		bright: (b) => tween('bright', b, 10),
		level: (n) => { while (level < n) setLevel(level + 1, 0); },
		stats: () => { const f = stats.slice(5).sort((a, b) => a - b); return { frames: f.length, median: f[f.length >> 1], p90: f[Math.floor(f.length * 0.9)], drawn: geo.drawRange.count === Infinity ? N : geo.drawRange.count, level, active }; },
		reset: () => { stats.length = 0; },
		png: (type, q) => canvas.toDataURL(type || 'image/png', q)
	};
	return api;
}

if (homeCanvas) {
	if (reduced()) giveUp();
	else try { site.pointcloud = init(homeCanvas, false); } catch (e) { console.warn('pointcloud:', e); giveUp(); }
}


// Bare instance on a caller-supplied canvas (egg on pages without the point cloud). Null if WebGL fails.
export function mount(cv) {
	try { return init(cv, true); } catch (e) { console.warn('pointcloud:', e); return null; }
}
