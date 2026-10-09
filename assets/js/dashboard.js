// Polaris dashboard: Pi status, 24 h sparklines, activity log, flower camera, lighting control.
// Data is static JSON the Pi pushes to GitHub Pages. The lights API lives on the owner's tailnet.
(function() {
	'use strict';
	const $ = (sel, root) => (root || document).querySelector(sel);
	const bust = (url) => url + '?_=' + Date.now();
	const REFRESH_MS = 60000;

	async function getJSON(url) {
		const res = await fetch(bust(url));
		if (!res.ok) throw new Error('HTTP ' + res.status);
		return res.json();
	}

	function ago(min) {
		if (!isFinite(min)) return '';
		if (min < 1) return 'just now';
		if (min < 60) return Math.round(min) + ' min ago';
		const h = Math.round(min / 60);
		if (h < 48) return h + ' h ago';
		return Math.round(h / 24) + ' days ago';
	}

	function niceDate(iso, opts) {
		const dt = new Date(iso);
		return isNaN(dt.getTime()) ? String(iso) : dt.toLocaleString(undefined, opts);
	}

	function svgEl(name, attrs) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', name);
		Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
		return el;
	}

	// ---- Pi status -------------------------------------------------------
	const statusTile = $('[data-dash-status]');
	function setHook(name, text) {
		const el = $('[data-dash-' + name + ']', statusTile);
		if (el) el.textContent = text;
	}

	function renderStatus(s) {
		// The Pi pushes this file every 15 minutes; if it stops, treat the Pi as offline.
		const ageMin = s.lastUpdated ? (Date.now() - new Date(s.lastUpdated).getTime()) / 60000 : Infinity;
		const online = !!s.piOnline && ageMin < 35;
		const state = online ? 'online' : (s.piOnline ? 'stale' : 'offline');
		statusTile.dataset.state = state;
		$('[data-dash-dot]', statusTile).classList.toggle('status-dot--warn', !online);
		setHook('state', online ? 'Online' : state === 'stale' ? 'Stale · not reporting' : 'Offline');
		setHook('host', s.hostname || '—');
		setHook('temp', s.cpuTempC != null ? Number(s.cpuTempC).toFixed(1) + ' °C' : '—');
		setHook('cpu', s.cpuPercent != null ? s.cpuPercent + ' %' : '—');
		const loads = [s.load1, s.load5, s.load15].filter((v) => v != null);
		setHook('load', loads.length ? loads.join(' ') : '—');
		setHook('mem', s.memory || '—');
		setHook('disk', s.diskRoot || '—');
		const upd = $('[data-dash-updated]', statusTile);
		if (s.lastUpdated) {
			upd.textContent = (online ? 'Updated ' : 'Last seen ') + ago(ageMin);
			upd.title = niceDate(s.lastUpdated, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
		} else {
			upd.textContent = '';
		}
	}

	function statusFailed(err) {
		statusTile.dataset.state = 'unknown';
		$('[data-dash-dot]', statusTile).classList.add('status-dot--warn');
		setHook('state', 'Status currently unavailable');
		setHook('updated', '');
		console.error('Failed to load Pi status', err);
	}

	// ---- Sparklines ------------------------------------------------------
	const W = 300, H = 64, PAD = 4;
	const DAY_MS = 24 * 3600 * 1000;

	function seriesFrom(history, key) {
		if (!Array.isArray(history)) return [];
		const pts = history
			.map((p) => ({ t: p ? new Date(p.t).getTime() : NaN, v: p && p[key] != null ? Number(p[key]) : NaN }))
			.filter((p) => isFinite(p.t) && isFinite(p.v))
			.sort((a, b) => a.t - b.t);
		if (!pts.length) return pts;
		const end = pts[pts.length - 1].t;
		return pts.filter((p) => p.t >= end - DAY_MS);
	}

	function drawSpark(box, pts) {
		const unit = box.dataset.sparkUnit || '';
		const digits = Number(box.dataset.sparkDigits || 1);
		const label = $('.spark__label', box).textContent;
		const fmt = (v) => v.toFixed(digits) + unit;
		box.querySelectorAll('.spark__chart, .spark__stats').forEach((el) => el.remove());
		const empty = $('.spark__empty', box);
		if (pts.length < 2) { empty.hidden = false; return; }
		empty.hidden = true;

		const vals = pts.map((p) => p.v);
		const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
		const cur = vals[vals.length - 1];
		const span = max - min || Math.max(Math.abs(max) * 0.1, 0.1);
		const lo = min - span * 0.15, hi = max + span * 0.15;
		const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
		const x = (t) => PAD + (t - t0) / (t1 - t0 || 1) * (W - 2 * PAD);
		const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
		const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
		const area = line + ' L' + x(t1).toFixed(1) + ' ' + (H - PAD) + ' L' + x(t0).toFixed(1) + ' ' + (H - PAD) + ' Z';

		const wrap = document.createElement('div');
		wrap.className = 'spark__chart';
		const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img',
			'aria-label': label + ' over the last ' + Math.max(1, Math.round((t1 - t0) / 3600000)) + ' h: min ' + fmt(min) + ', max ' + fmt(max) + ', now ' + fmt(cur) });
		[0.25, 0.5, 0.75].forEach((f) => svg.appendChild(svgEl('line', { class: 'spark__grid', x1: 0, x2: W, y1: H * f, y2: H * f })));
		svg.appendChild(svgEl('path', { class: 'spark__area', d: area }));
		svg.appendChild(svgEl('path', { class: 'spark__line', d: line }));
		wrap.appendChild(svg);
		// End marker as HTML so the non-uniform SVG scale doesn't squash it
		const dot = document.createElement('span');
		dot.className = 'spark__dot';
		dot.style.left = (x(t1) / W * 100) + '%';
		dot.style.top = (y(cur) / H * 100) + '%';
		wrap.appendChild(dot);

		const stats = document.createElement('dl');
		stats.className = 'spark__stats mono';
		[['min', min], ['max', max], ['now', cur]].forEach((pair) => {
			const d = document.createElement('div');
			const dt = document.createElement('dt'); dt.textContent = pair[0];
			const dd = document.createElement('dd'); dd.textContent = fmt(pair[1]);
			d.append(dt, dd);
			stats.appendChild(d);
		});
		box.append(wrap, stats);
	}

	function renderSparks(history) {
		let first = null, last = null, n = 0;
		document.querySelectorAll('[data-spark]').forEach((box) => {
			const pts = seriesFrom(history, box.dataset.spark);
			drawSpark(box, pts);
			if (pts.length >= 2) {
				n = Math.max(n, pts.length);
				first = first == null ? pts[0].t : Math.min(first, pts[0].t);
				last = last == null ? pts[pts.length - 1].t : Math.max(last, pts[pts.length - 1].t);
			}
		});
		const range = $('[data-spark-range]');
		if (range) {
			range.textContent = n ? n + ' samples · ' + niceDate(first, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' → ' + niceDate(last, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
		}
	}

	async function loadStatus() {
		if (!statusTile) return;
		try {
			// Static JSON generated on the Raspberry Pi and pushed to GitHub Pages
			const s = await getJSON('polaris-pi-status.json');
			if (!s) throw new Error('Empty status');
			renderStatus(s);
			renderSparks(s.history);
		} catch (err) {
			statusFailed(err);
			renderSparks(null);
		}
	}

	// ---- Activity log ----------------------------------------------------
	const LOG_FIRST = 12;
	const logList = $('[data-log-list]');
	const logMore = $('[data-log-more]');

	function entryNode(e, isLatest) {
		const li = document.createElement('li');
		li.className = 'term__entry';
		const det = document.createElement('details');
		const sum = document.createElement('summary');
		const when = document.createElement('span');
		when.className = 'term__when';
		when.textContent = [e.date, e.time].filter(Boolean).join(' ') || '—';
		const text = document.createElement('span');
		text.className = 'term__text';
		text.textContent = e.summary || 'Change';
		if (isLatest) text.setAttribute('data-typewriter', '');
		sum.append(when, text);
		det.appendChild(sum);
		const body = document.createElement('div');
		body.className = 'term__details';
		if (e.details) {
			const p = document.createElement('p');
			p.textContent = e.details;
			body.appendChild(p);
		}
		const files = Array.isArray(e.files) ? e.files : [];
		if (files.length) {
			const ul = document.createElement('ul');
			ul.className = 'term__files';
			ul.setAttribute('role', 'list');
			ul.setAttribute('aria-label', 'Files changed');
			files.forEach((f) => { const fi = document.createElement('li'); fi.textContent = f; ul.appendChild(fi); });
			body.appendChild(ul);
		}
		if (!body.childNodes.length) {
			const p = document.createElement('p');
			p.textContent = 'No details recorded.';
			body.appendChild(p);
		}
		det.appendChild(body);
		li.appendChild(det);
		return li;
	}

	function logMessage(text) {
		logList.innerHTML = '';
		const li = document.createElement('li');
		li.className = 'term__msg';
		li.textContent = text;
		logList.appendChild(li);
	}

	async function loadLog() {
		if (!logList) return;
		const count = $('[data-log-count]');
		try {
			const entries = await getJSON('polaris-log.json');
			if (!Array.isArray(entries) || entries.length === 0) {
				logMessage('No entries yet.');
				return;
			}
			// File is oldest-first; sort by date + time, ties keep file order (later = newer)
			const sorted = entries
				.map((e, i) => ({ e: e, i: i, k: (e.date || '') + ' ' + (e.time || '') }))
				.sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : b.i - a.i))
				.map((x) => x.e);
			logList.innerHTML = '';
			sorted.forEach((e, i) => {
				const li = entryNode(e, i === 0);
				if (i >= LOG_FIRST) li.hidden = true;
				logList.appendChild(li);
			});
			if (count) count.textContent = sorted.length + ' entries';
			const rest = sorted.length - LOG_FIRST;
			if (rest > 0 && logMore) {
				logMore.textContent = '… show ' + rest + ' older entr' + (rest === 1 ? 'y' : 'ies');
				logMore.hidden = false;
				logMore.addEventListener('click', () => {
					const firstHidden = logList.querySelector('.term__entry[hidden] summary');
					logList.querySelectorAll('.term__entry[hidden]').forEach((li) => { li.hidden = false; });
					logMore.hidden = true;
					if (firstHidden) firstHidden.focus();
				}, { once: true });
			}
			const latest = $('[data-typewriter]', logList);
			if (latest) document.dispatchEvent(new CustomEvent('polaris:latest', { detail: { el: latest } }));
		} catch (err) {
			logMessage('Could not load log right now.');
			console.error('Failed to load Polaris log', err);
		}
	}

	// ---- Flower camera ---------------------------------------------------
	async function loadFlower() {
		const tile = $('[data-flower]');
		if (!tile) return;
		try {
			const data = await getJSON('flower-tracker.json');
			if (!data || !data.image) throw new Error('Empty payload');

			// Hide the tile when the camera hasn't sent a snapshot in the last 6 hours.
			const ageH = data.lastUpdated ? (Date.now() - new Date(data.lastUpdated).getTime()) / 3600000 : Infinity;
			if (!(ageH < 6)) throw new Error('Snapshot is stale');

			const img = document.createElement('img');
			img.src = data.image + '?_=' + Date.now(); // bust caches
			img.alt = 'Latest flower snapshot';
			img.decoding = 'async';
			const frame = $('[data-flower-frame]', tile);
			frame.innerHTML = '';
			frame.appendChild(img);
			$('[data-flower-meta]', tile).textContent = 'Last updated: ' + (data.lastUpdated
				? niceDate(data.lastUpdated, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
				: 'unknown');
			tile.hidden = false;
		} catch (err) {
			tile.hidden = true;
			console.info('Flower tracker hidden:', err.message);
		}
	}

	// ---- Lighting control ------------------------------------------------
	(function lights() {
		// Lights API is reachable only on the owner's tailnet (Tailscale Serve, HTTPS).
		// The token is checked by the Pi; nothing secret lives in this page.
		const apiBase = 'https://polaris.tailaf1119.ts.net';
		const tile = $('#lights');
		const input = $('#lights-password');
		const btn = $('#lights-unlock');
		const panel = $('#lights-panel');
		const statusEl = $('#lights-status');
		if (!tile || !input || !btn || !panel) return;
		const auth = $('[data-lights-auth]', tile);
		const badge = $('[data-lights-badge]', tile);
		const slider = $('#lights-bright');
		const out = $('[data-bright-out]', tile);
		const change = $('[data-lights-change]', tile);

		let token = '';
		try { token = localStorage.getItem('lightsToken') || ''; } catch (e) {}

		function setStatus(msg, tone) {
			if (!statusEl) return;
			statusEl.textContent = msg;
			statusEl.dataset.tone = tone || '';
		}

		function setUnlocked(on) {
			panel.hidden = !on;
			auth.hidden = on;
			tile.dataset.lights = on ? 'unlocked' : 'locked';
			if (badge) badge.textContent = on ? 'Connected' : 'Locked';
		}

		function callApi(path, body) {
			return fetch(apiBase + path, {
				method: body ? 'POST' : 'GET',
				headers: Object.assign({ 'Authorization': 'Bearer ' + token },
					body ? { 'Content-Type': 'application/json' } : {}),
				body: body ? JSON.stringify(body) : undefined
			}).then((res) => {
				if (res.status === 401) throw new Error('unauthorized');
				if (!res.ok) throw new Error('HTTP ' + res.status);
				return res.json();
			});
		}

		function tryUnlock() {
			const typed = (input.value || '').trim();
			if (typed) token = typed;
			if (!token) return;
			setStatus('Connecting to Polaris…', 'busy');
			btn.setAttribute('aria-busy', 'true');
			callApi('/api/lights/ping').then(() => {
				try { localStorage.setItem('lightsToken', token); } catch (e) {}
				input.value = '';
				setUnlocked(true);
				setStatus('Connected.', 'ok');
			}).catch((err) => {
				setUnlocked(false);
				if (err.message === 'unauthorized') {
					try { localStorage.removeItem('lightsToken'); } catch (e) {}
					setStatus('Token not accepted.', 'error');
				} else {
					setStatus('Can’t reach Polaris. Make sure this device is connected to Tailscale.', 'error');
				}
			}).finally(() => btn.removeAttribute('aria-busy'));
		}

		btn.addEventListener('click', tryUnlock);
		input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') tryUnlock(); });
		if (change) change.addEventListener('click', () => { auth.hidden = false; input.focus(); });
		if (token) tryUnlock();

		function send(el, req, onOk) {
			if (!req) return;
			if (el) el.classList.add('is-busy');
			setStatus('Sending…', 'busy');
			req.then(() => { setStatus('Done.', 'ok'); if (onOk) onOk(); })
				.catch((err) => setStatus('Failed: ' + err.message, 'error'))
				.finally(() => { if (el) el.classList.remove('is-busy'); });
		}

		function setBright(v) {
			if (slider) {
				slider.value = v;
				slider.style.setProperty('--fill', v + '%');
			}
			if (out) out.textContent = v + '%';
		}

		panel.addEventListener('click', (ev) => {
			const target = ev.target instanceof Element ? ev.target.closest('[data-power], [data-bright], [data-scene]') : null;
			if (!target) return;
			const power = target.getAttribute('data-power');
			const bright = target.getAttribute('data-bright');
			const scene = target.getAttribute('data-scene');
			if (power) {
				send(target, callApi('/api/lights/power', { value: power }), () => {
					panel.querySelectorAll('[data-power]').forEach((b) => b.setAttribute('aria-pressed', String(b === target)));
				});
			} else if (bright) {
				setBright(Number(bright));
				send(target, callApi('/api/lights/brightness', { value: Number(bright) }));
			} else if (scene) {
				send(target, callApi('/api/lights/preset', { value: scene === 'bright-white' ? 'bright_white_cool' : 'bright_white_warm' }));
			}
		});

		if (slider) {
			setBright(Number(slider.value));
			slider.addEventListener('input', () => setBright(Number(slider.value)));
			// Send once the visitor lets go, not on every step
			slider.addEventListener('change', () => send(null, callApi('/api/lights/brightness', { value: Number(slider.value) })));
		}
	})();

	loadStatus();
	loadFlower();
	loadLog();
	setInterval(() => { if (!document.hidden) loadStatus(); }, REFRESH_MS);
})();
