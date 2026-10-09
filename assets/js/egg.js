// Egg, loaded on demand by site.js. Edge glow -> scan sweep warming blue to rose ->
// point cloud lifts over the dimmed page and forms a heart -> two beats and a note -> dissolve.
// Any click, wheel, touch scroll or Escape cancels. Resolves once everything is gone.
const here = import.meta.url;
const NOTE = '4pymIEV2ZXJ5IHJvYm90IG5lZWRzIGEgTm9ydGggU3Rhci4gTWluZSBpcyBTaGl2YW5pLg==';
const decode = (b) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));

function loadCss() {
	if (document.querySelector('link[data-egg]')) return Promise.resolve();
	const l = document.createElement('link');
	l.rel = 'stylesheet';
	l.href = new URL('../css/egg.css', here).href;
	l.dataset.egg = '';
	document.head.append(l);
	return new Promise((r) => { l.onload = l.onerror = r; });
}

// Same parametric curve as the point-cloud heart, as an SVG path.
function heartPath() {
	let d = '';
	for (let i = 0; i <= 96; i++) {
		const t = i / 96 * 6.2832;
		const x = 16 * Math.pow(Math.sin(t), 3), y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
		d += (i ? 'L' : 'M') + (x + 18).toFixed(2) + ' ' + (14 - y).toFixed(2);
	}
	return d + 'Z';
}

// Probe before fetching Three.js on pages without the point cloud.
function hasGl() {
	try {
		const g = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
		const x = g && g.getExtension('WEBGL_lose_context');
		if (x) x.loseContext();
		return !!g;
	} catch (e) { return false; }
}

export default async function run() {
	await loadCss();
	const root = document.documentElement, site = window.site || {};
	const reduced = site.reducedMotion ? site.reducedMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches;
	const made = [];
	const el = (cls, html) => {
		const e = document.createElement('div');
		e.className = cls;
		if (html) e.innerHTML = html;
		e.setAttribute('aria-hidden', 'true');
		document.body.append(e);
		made.push(e);
		return e;
	};
	const dim = el('egg-dim');
	const fx = el('egg-fx', '<div class="egg-glow egg-glow--blue"></div><div class="egg-glow egg-glow--rose"></div><div class="egg-scan"></div>');
	const note = el('egg-note');
	note.removeAttribute('aria-hidden');
	note.setAttribute('role', 'status');
	note.setAttribute('aria-live', 'polite');
	let heart = null, over = false, released = false, finish;

	// Point cloud: the homepage's own instance, else a bare one on a temporary canvas (Three.js loads only now).
	const home = site.pointcloud || null;
	let bare = null;
	const pcReady = reduced || root.classList.contains('pc-static') ? Promise.resolve(null)
		: home ? Promise.resolve(home)
		: !hasGl() ? Promise.resolve(null)
		: import(new URL('pointcloud.js', here).href).then((m) => {
			if (over) return null;
			const stage = el('egg-stage');
			const cv = document.createElement('canvas');
			stage.append(cv);
			return (bare = m.mount(cv));
		}).catch((e) => { console.warn('egg:', e); return null; });
	let pc = null;

	const finished = new Promise((r) => { finish = r; });
	const timers = [];
	const at = (ms, fn) => timers.push(setTimeout(fn, ms));

	function cleanup() {
		removeEventListener('click', cancel, true);
		removeEventListener('wheel', cancel, { passive: true });
		removeEventListener('touchmove', cancel, { passive: true });
		removeEventListener('keydown', onKey, true);
		root.classList.remove('egg-active', 'egg-cancel');
		pcReady.then(() => {
			if (bare) bare.destroy();
			made.forEach((e) => e.remove());
			finish();
		});
	}
	function cancel() {
		if (over) return;
		over = true;
		timers.forEach(clearTimeout);
		root.classList.add('egg-cancel');
		if (pc && !released) pc.egg.release(pc === home ? 700 : 300);
		setTimeout(cleanup, 350);
	}
	function onKey(ev) { if (ev.key === 'Escape') cancel(); }
	addEventListener('click', cancel, true);
	addEventListener('wheel', cancel, { passive: true });
	addEventListener('touchmove', cancel, { passive: true });
	addEventListener('keydown', onKey, true);

	function showHeart() {
		heart = el('egg-heart', '<svg viewBox="0 0 36 32"><path d="' + heartPath() + '"/></svg>');
		void heart.offsetWidth;
		heart.classList.add('is-on');
	}
	function fillNote() {
		const text = decode(NOTE), mark = text.slice(0, 1), rest = text.slice(1).trim();
		const cut = rest.lastIndexOf(' ') + 1, name = rest.slice(cut).replace(/\.$/, '');
		const m = document.createElement('span'), b = document.createElement('b');
		m.className = 'egg-note__mark';
		m.textContent = mark;
		b.textContent = name;
		note.append(m, rest.slice(0, cut), b, '.');
		note.classList.add('is-in');
	}

	// 0-1 s glow, 1-3 s sweep + warm, then the heart (h0) once the point cloud is ready (or given up on).
	void fx.offsetWidth;
	fx.classList.add('is-glow');
	at(1000, () => fx.classList.add('is-scan', 'is-warm'));
	at(3000, async () => {
		dim.classList.add('is-on');
		pc = await Promise.race([pcReady, new Promise((r) => setTimeout(r, 1500, null))]);
		if (over) return;
		if (pc && !pc.lost) {
			if (pc === home) root.classList.add('egg-active');
			pc.egg.heart(1900);
		} else {
			pc = null;
			showHeart();
		}
		at(2000, () => { if (pc) pc.egg.beat(); else heart.classList.add('is-beat'); });
		at(2300, fillNote);
		at(5000, () => {
			released = true;
			if (pc) pc.egg.release(1600); else heart.classList.add('is-out');
			dim.classList.remove('is-on');
			fx.classList.add('is-out');
		});
		at(6800, () => root.classList.remove('egg-active'));
		at(10000, () => note.classList.remove('is-in'));
		at(10600, () => { over = true; cleanup(); });
	});
	return finished;
}
