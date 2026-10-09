// Polaris live status: fills any [data-polaris-live] container from the JSON the Pi pushes.
// Hooks inside the container (all optional): data-pl-dot, data-pl-state, data-pl-host, data-pl-temp,
// data-pl-cpu, data-pl-load, data-pl-mem, data-pl-disk, data-pl-updated, data-pl-latest, data-pl-latest-when.
// API: window.polarisLive = { load, render, refresh }.
(function() {
	'use strict';

	const STATUS_URL = 'polaris-pi-status.json';
	const LOG_URL = 'polaris-log.json';
	// The Pi pushes every 15 min; polaris.html treats > 35 min without a push as stale.
	const STALE_MIN = 35;
	const REFRESH_MS = 60000;

	async function getJSON(url) {
		const res = await fetch(url, { cache: 'no-store' });
		if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
		return res.json();
	}

	// Log is oldest-first, but sort anyway; ties keep file order so the last one wins.
	function newest(log) {
		if (!Array.isArray(log) || !log.length) return null;
		let best = null;
		log.forEach(function(e) {
			const key = (e.date || '') + ' ' + (e.time || '');
			if (!best || key >= best.key) best = { key: key, entry: e };
		});
		return best.entry;
	}

	async function load() {
		const r = await Promise.allSettled([getJSON(STATUS_URL), getJSON(LOG_URL)]);
		return {
			status: r[0].status === 'fulfilled' ? r[0].value : null,
			latest: r[1].status === 'fulfilled' ? newest(r[1].value) : null
		};
	}

	function ago(ms) {
		const min = Math.round(ms / 60000);
		if (min < 1) return 'just now';
		if (min < 60) return min + ' min ago';
		const h = Math.round(min / 60);
		if (h < 48) return h + ' h ago';
		return Math.round(h / 24) + ' days ago';
	}

	function shortDate(date, time) {
		const p = (date || '').split('-').map(Number);
		if (p.length !== 3 || p.some(isNaN)) return [date, time].filter(Boolean).join(' ');
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return months[p[1] - 1] + ' ' + p[2] + (time ? ' · ' + time : '');
	}

	function setText(root, hook, text) {
		root.querySelectorAll('[data-pl-' + hook + ']').forEach(function(el) { el.textContent = text; });
	}

	function render(root, data) {
		const s = data && data.status;
		const dot = root.querySelector('[data-pl-dot]');
		let state = 'Status unavailable';
		let ok = false;
		if (s) {
			const t = s.lastUpdated ? new Date(s.lastUpdated).getTime() : NaN;
			const age = isNaN(t) ? Infinity : Date.now() - t;
			if (!s.piOnline) state = 'Offline';
			else if (age > STALE_MIN * 60000) state = 'Stale';
			else { state = 'Online'; ok = true; }
			setText(root, 'host', s.hostname || '—');
			setText(root, 'temp', s.cpuTempC != null ? s.cpuTempC.toFixed(1) + ' °C' : '—');
			setText(root, 'cpu', s.cpuPercent != null ? s.cpuPercent + ' %' : '—');
			setText(root, 'load', s.load1 != null ? String(s.load1) : '—');
			setText(root, 'mem', s.memory || '—');
			setText(root, 'disk', s.diskRoot ? s.diskRoot.replace(/\s*\(.*\)$/, '') : '—');
			setText(root, 'updated', isFinite(age) ? 'Updated ' + ago(age) : '');
		} else {
			setText(root, 'updated', '');
		}
		setText(root, 'state', state);
		if (dot) dot.classList.toggle('status-dot--warn', !ok);
		root.dataset.liveState = state.toLowerCase().replace(/\s+/g, '-');

		const latest = data && data.latest;
		const latestText = latest ? (latest.summary || 'Change') : (s ? 'No recent actions' : 'Status unavailable');
		setText(root, 'latest-when', latest ? shortDate(latest.date, latest.time) : '');
		root.querySelectorAll('[data-pl-latest]').forEach(function(el) {
			if (el.textContent === latestText && el.dataset.plFilled) return;
			el.textContent = latestText;
			el.dataset.plFilled = '1';
			if (el.hasAttribute('data-typewriter')) {
				document.dispatchEvent(new CustomEvent('polaris:latest', { detail: { el: el } }));
			}
		});
	}

	const roots = document.querySelectorAll('[data-polaris-live]');
	async function refresh() {
		if (!roots.length) return;
		const data = await load();
		roots.forEach(function(root) { render(root, data); });
	}

	window.polarisLive = { load: load, render: render, refresh: refresh };
	if (!roots.length) return;

	refresh();
	setInterval(function() { if (!document.hidden) refresh(); }, REFRESH_MS);
	document.addEventListener('visibilitychange', function() { if (!document.hidden) refresh(); });
})();
