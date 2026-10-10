// Frames lightbox, shared by the Frames grid (frames.js) and Story pages (story.js).
//   FramesLightbox.open(photos, index, { origin, onClose, onChange, getOrigin, mediaBase })
//   FramesLightbox.close()
// Zooms up from `origin`, shows w2560 (w1280 via srcset on small screens) at once and fades in
// `full` once decoded; viewfinder HUD over the photo; Shot details sheet below it.
(function() {
	'use strict';
	const COPYRIGHT = '© Hardik Devrangadi';
	const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const reduced = () => (window.site && window.site.reducedMotion ? window.site.reducedMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches);
	const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));

	let root = null, ui = null;
	let st = null;          // { photos, index, opts, token, fit, zoom, full }
	let lastFocus = null, inerted = [], hudOn = true, busy = null, ptr = null, pendingClose = null;
	try { hudOn = localStorage.getItem('frames-hud') !== 'off'; } catch (e) {}
	document.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') ptr = [ev.clientX, ev.clientY]; }, { passive: true });

	const ICONS = {
		prev: '<path d="M15 5l-7 7 7 7"/>',
		next: '<path d="M9 5l7 7-7 7"/>',
		close: '<path d="M6 6l12 12M18 6L6 18"/>',
		hud: '<path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4"/><circle cx="12" cy="12" r="1.25"/>',
		down: '<path d="M6 9l6 6 6-6"/>'
	};
	const svg = (name) => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';

	function build() {
		root = document.createElement('div');
		root.className = 'flb';
		root.hidden = true;
		root.setAttribute('role', 'dialog');
		root.setAttribute('aria-modal', 'true');
		root.setAttribute('data-lenis-prevent', '');
		root.innerHTML =
			'<div class="flb__backdrop"></div>' +
			'<div class="flb__scroll">' +
				'<div class="flb__stage">' +
					'<div class="flb__frame">' +
						'<div class="flb__zoom">' +
							'<img class="flb__thumb" alt="" aria-hidden="true" draggable="false" />' +
							'<img class="flb__img" alt="" draggable="false" />' +
							'<img class="flb__img flb__img--full" alt="" aria-hidden="true" draggable="false" />' +
						'</div>' +
						'<div class="flb__hud" aria-hidden="true">' +
							'<span class="flb__c flb__c--tl"></span><span class="flb__c flb__c--tr"></span><span class="flb__c flb__c--bl"></span><span class="flb__c flb__c--br"></span>' +
							'<div class="flb__hud-row flb__hud-row--top"><p class="flb__hud-t flb__hud-tl"></p>' +
							'<p class="flb__hud-t flb__hud-tr"><span>' + COPYRIGHT + '</span><a class="flb__hud-geo" target="_blank" rel="noopener" tabindex="-1"></a></p></div>' +
							'<div class="flb__hud-row flb__hud-row--bottom"><p class="flb__hud-t flb__hud-bl"></p>' +
							'<p class="flb__hud-t flb__hud-br"></p></div>' +
						'</div>' +
					'</div>' +
					'<button class="flb__nav flb__nav--prev" type="button" aria-label="Previous photo">' + svg('prev') + '</button>' +
					'<p class="flb__count mono" aria-hidden="true"></p>' +
					'<button class="flb__nav flb__nav--next" type="button" aria-label="Next photo">' + svg('next') + '</button>' +
					'<button class="flb__more mono" type="button">Shot details' + svg('down') + '</button>' +
				'</div>' +
				'<section class="flb__sheet" aria-label="Shot details">' +
					'<div class="flb__sheet-inner">' +
						'<div class="flb__words">' +
							'<p class="flb__note"></p>' +
							'<p class="flb__place mono"></p>' +
							'<p class="flb__badges"><span class="flb__hdr mono" hidden>HDR</span></p>' +
						'</div>' +
						'<div class="flb__specs">' +
							'<h2 class="eyebrow flb__specs-title">Shot details</h2>' +
							'<dl class="flb__dl mono"></dl>' +
						'</div>' +
					'</div>' +
				'</section>' +
			'</div>' +
			'<div class="flb__bar">' +
				'<span class="flb__chip mono" aria-hidden="true"></span>' +
				'<button class="flb__btn flb__btn--hud" type="button" aria-label="Viewfinder overlay" title="Viewfinder (i)">' + svg('hud') + '</button>' +
				'<button class="flb__btn flb__btn--close" type="button" aria-label="Close" title="Close (Esc)">' + svg('close') + '</button>' +
			'</div>' +
			'<p class="visually-hidden flb__live" aria-live="polite"></p>';
		const q = (s) => root.querySelector(s);
		ui = {
			scroll: q('.flb__scroll'), stage: q('.flb__stage'), frame: q('.flb__frame'), zoom: q('.flb__zoom'),
			thumb: q('.flb__thumb'), img: q('.flb__img'), full: q('.flb__img--full'), hud: q('.flb__hud'),
			tl: q('.flb__hud-tl'), geo: q('.flb__hud-geo'), bl: q('.flb__hud-bl'), br: q('.flb__hud-br'),
			prev: q('.flb__nav--prev'), next: q('.flb__nav--next'), count: q('.flb__count'), more: q('.flb__more'),
			sheet: q('.flb__sheet'), note: q('.flb__note'), place: q('.flb__place'), hdr: q('.flb__hdr'),
			specs: q('.flb__specs'), dl: q('.flb__dl'), chip: q('.flb__chip'),
			hudBtn: q('.flb__btn--hud'), close: q('.flb__btn--close'), live: q('.flb__live'), backdrop: q('.flb__backdrop')
		};
		document.body.appendChild(root);
		ui.prev.addEventListener('click', () => go(-1));
		ui.next.addEventListener('click', () => go(1));
		ui.close.addEventListener('click', () => close());
		ui.hudBtn.addEventListener('click', toggleHud);
		ui.more.addEventListener('click', () => ui.sheet.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }));
		gestures();
		window.addEventListener('resize', () => { if (st && !root.hidden) { resetZoom(false); layout(); } });
	}

	// ---- formatting --------------------------------------------------------------
	function url(path) {
		if (!path) return '';
		if (/^(https?:)?\/\//.test(path) || path.charAt(0) === '/') return path;
		const base = (st && st.opts.mediaBase) || window.FramesLightbox.mediaBase || '/_media/frames';
		return base.replace(/\/$/, '') + '/' + path;
	}
	const has = (v) => v !== null && v !== undefined && v !== '';
	function fmtTaken(iso) {
		const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(iso || '');
		if (!m) return iso || '';
		let s = (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
		if (m[4]) s += ', ' + m[4] + ':' + m[5];
		if (m[6]) {
			if (m[6] === 'Z') s += ' (UTC)';
			else {
				const o = /([+-])(\d{2}):?(\d{2})/.exec(m[6]);
				s += ' (UTC' + (o[1] === '-' ? '−' : '+') + (+o[2]) + (o[3] !== '00' ? ':' + o[3] : '') + ')';
			}
		}
		return s;
	}
	function fmtCoords(g) {
		return Math.abs(g.lat).toFixed(4) + '° ' + (g.lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(g.lon).toFixed(4) + '° ' + (g.lon >= 0 ? 'E' : 'W');
	}
	const mapUrl = (g) => 'https://www.openstreetmap.org/?mlat=' + g.lat + '&mlon=' + g.lon + '#map=16/' + g.lat + '/' + g.lon;
	const hasGps = (g) => g && typeof g.lat === 'number' && typeof g.lon === 'number';
	const dims = (p) => (p.width && p.height ? p.width + ' × ' + p.height : '');

	// ---- render one Photo into the HUD and sheet ---------------------------------------
	function render(p) {
		const s = p.shot || {};
		const label = p.note || p.alt || 'Photo';
		root.setAttribute('aria-label', label);
		ui.img.alt = p.alt || '';
		// Each part stays whole; a narrow photo breaks the line only between them
		ui.tl.replaceChildren();
		[s.camera, s.lens].filter(has).forEach(function(part, i) {
			if (i) ui.tl.append(' · ');
			const span = document.createElement('span');
			span.style.whiteSpace = 'nowrap';
			span.textContent = part;
			ui.tl.append(span);
		});
		ui.bl.textContent = [s.aperture, s.shutter, has(s.iso) ? 'ISO ' + s.iso : null, has(s.focal35) ? s.focal35 : s.focalLength].filter(has).join(' · ');
		ui.br.textContent = [dims(p), has(s.megapixels) ? s.megapixels + ' MP' : null].filter(has).join(' · ');
		if (hasGps(s.gps)) {
			ui.geo.hidden = false;
			ui.geo.href = mapUrl(s.gps);
			ui.geo.textContent = fmtCoords(s.gps) + ' ↗';
		} else {
			ui.geo.hidden = true;
			ui.geo.removeAttribute('href');
			ui.geo.textContent = '';
		}
		ui.note.textContent = p.note || '';
		ui.note.hidden = !p.note;
		ui.place.textContent = p.place ? '📍 ' + p.place : '';
		ui.place.hidden = !p.place;
		ui.hdr.hidden = !p.hdr;
		ui.hdr.parentElement.hidden = !p.hdr;

		const focal = has(s.focalLength) ? s.focalLength + (has(s.focal35) && s.focal35 !== s.focalLength ? ' (' + s.focal35 + ' equiv.)' : '') : has(s.focal35) ? s.focal35 + ' equiv.' : null;
		const alt = s.gps && has(s.gps.altitude) ? Math.round(s.gps.altitude) + ' m' : null;
		const rows = [
			['Camera', s.camera], ['Lens', s.lens], ['Focal length', focal], ['Aperture', s.aperture],
			['Shutter', s.shutter], ['ISO', s.iso], ['Exposure comp.', s.exposureComp],
			['Dimensions', dims(p) ? dims(p) + ' px' : null], ['Megapixels', has(s.megapixels) ? s.megapixels + ' MP' : null],
			['Taken', has(s.taken) ? fmtTaken(s.taken) : null]
		];
		ui.dl.replaceChildren();
		rows.forEach(function(r) {
			if (!has(r[1])) return;
			addRow(r[0], document.createTextNode(String(r[1])));
		});
		if (hasGps(s.gps)) {
			const dd = document.createDocumentFragment();
			dd.append(fmtCoords(s.gps) + ' ');
			const a = document.createElement('a');
			a.href = mapUrl(s.gps);
			a.target = '_blank';
			a.rel = 'noopener';
			a.className = 'flb__map';
			a.innerHTML = 'Map <span aria-hidden="true">↗</span><span class="visually-hidden"> (OpenStreetMap, opens in a new tab)</span>';
			dd.append(a);
			addRow('Coordinates', dd);
			if (alt) addRow('Altitude', document.createTextNode(alt));
		}
		ui.specs.hidden = !ui.dl.children.length;
	}
	function addRow(label, content) {
		const div = document.createElement('div');
		const dt = document.createElement('dt');
		const dd = document.createElement('dd');
		dt.textContent = label;
		dd.append(content);
		div.append(dt, dd);
		ui.dl.append(div);
	}

	// ---- layout: photo as large as the viewport allows ----------------------------------
	function fitFor(p) {
		const vw = ui.scroll.clientWidth || innerWidth;
		const vh = innerHeight;
		const phone = vw < 720;
		const padX = phone ? 0 : vw >= 1024 ? 88 : 64;
		const padT = phone ? 56 : 64;
		const padB = phone ? 64 : 64;
		const ar = p.width && p.height ? p.width / p.height : 1.5;
		const availW = vw - 2 * padX, availH = Math.max(120, vh - padT - padB);
		let w = availW, h = w / ar;
		if (h > availH) { h = availH; w = h * ar; }
		const stageH = phone ? Math.min(vh, Math.round(h + padT + padB)) : vh;
		return { vw: vw, vh: vh, w: w, h: h, x: (vw - w) / 2, y: phone ? (stageH - h) / 2 + (padT - padB) / 2 : padT + (availH - h) / 2, stageH: stageH, phone: phone };
	}
	function layout() {
		const p = st.photos[st.index];
		const f = st.fit = fitFor(p);
		ui.stage.style.height = f.stageH + 'px';
		Object.assign(ui.frame.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
		ui.img.sizes = Math.ceil(f.w) + 'px';
	}
	// srcset widths: files are "long edge N", so the width descriptor depends on orientation
	function srcset(p) {
		const W = p.width || 2560, H = p.height || 1707;
		const wOf = (n) => Math.round(W * Math.min(1, n / Math.max(W, H)));
		const a = wOf(1280), b = wOf(2560);
		return p.src.w1280 && a !== b ? url(p.src.w1280) + ' ' + a + 'w, ' + url(p.src.w2560) + ' ' + b + 'w' : '';
	}
	function setImage(img, p, sizes) {
		img.removeAttribute('srcset');
		img.sizes = sizes;
		const set = srcset(p);
		if (set) img.srcset = set;
		img.src = url(p.src.w2560 || p.src.w1280 || p.src.full);
	}
	const decoded = (img, max) => Promise.race([
		img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {}),
		wait(max)
	]);

	// ---- full resolution: always on wide screens and for HDR; on phones only when zoomed --
	function wantFull(p) {
		const conn = navigator.connection;
		if (conn && conn.saveData) return st.zoom.s > 1;
		return !st.fit.phone || p.hdr || st.zoom.s > 1 || st.fit.w * (devicePixelRatio || 1) > 2560;
	}
	function loadFull() {
		const p = st.photos[st.index];
		if (!p.src.full || st.full === st.token) return;
		st.full = st.token;
		const token = st.token;
		const img = ui.full;
		img.classList.remove('is-loaded');
		img.src = url(p.src.full);
		updateChip();
		img.decode().then(function() {
			if (!st || token !== st.token) return;
			img.classList.add('is-loaded');
			st.fullReady = true;
			updateChip();
		}).catch(function() {});
	}
	function clearFull() {
		ui.full.classList.remove('is-loaded');
		ui.full.removeAttribute('src');
		st.full = 0;
		st.fullReady = false;
	}

	// Preload neighbours at the size they'll be shown
	const cache = new Map();
	function preload(i) {
		const p = st.photos[i];
		if (!p || cache.has(p.slug)) return;
		const img = new Image();
		img.decoding = 'async';
		setImage(img, p, Math.ceil(fitFor(p).w) + 'px');
		cache.set(p.slug, img);
		if (cache.size > 8) cache.delete(cache.keys().next().value);
	}

	// ---- show a Photo ------------------------------------------------------------------
	function show(i) {
		const p = st.photos[i];
		st.index = i;
		st.token++;
		resetZoom(false);
		clearFull();
		render(p);
		layout();
		ui.thumb.removeAttribute('src');
		ui.thumb.hidden = true;
		setImage(ui.img, p, Math.ceil(st.fit.w) + 'px');
		const n = st.photos.length;
		ui.count.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0');
		ui.count.hidden = ui.prev.hidden = ui.next.hidden = n < 2;
		setDisabled(ui.prev, i === 0, ui.next);
		setDisabled(ui.next, i === n - 1, ui.prev);
		const token = st.token;
		decoded(ui.img, 4000).then(function() {
			if (!st || token !== st.token) return;
			preload(i + 1); preload(i - 1);
			setTimeout(function() { if (st && token === st.token && wantFull(p)) loadFull(); }, 250);
		});
	}
	function setDisabled(btn, off, other) {
		if (off && document.activeElement === btn && !other.disabled) other.focus();
		btn.disabled = off;
	}

	function go(delta, fromX) {
		if (!st || busy) return;
		const i = st.index + delta;
		if (i < 0 || i >= st.photos.length) { springBack(); return; }
		const frame = ui.frame;
		const instant = reduced();
		const out = instant ? Promise.resolve() : frame.animate(
			[{ transform: 'translateX(' + (fromX || 0) + 'px)', opacity: 1 }, { transform: 'translateX(' + (-delta * 48 + (fromX || 0) * 1.4) + 'px)', opacity: 0 }],
			{ duration: 160, easing: 'ease-in', fill: 'forwards' }).finished;
		busy = out.then(function() {
			frame.style.transform = '';
			show(i);
			ui.live.textContent = 'Photo ' + (i + 1) + ' of ' + st.photos.length + ': ' + (st.photos[i].note || st.photos[i].alt || '');
			if (st.opts.onChange) try { st.opts.onChange(i, st.photos[i]); } catch (e) { console.warn(e); }
			return decoded(ui.img, 450);
		}).then(function() {
			frame.getAnimations().forEach((a) => a.cancel());
			if (instant) return;
			return frame.animate(
				[{ transform: 'translateX(' + (delta * 48) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
				{ duration: 320, easing: EASE }).finished;
		}).catch(function() {}).then(function() { busy = null; });
	}
	function springBack() {
		const t = ui.frame.style.transform;
		ui.frame.style.transform = '';
		if (t && !reduced()) ui.frame.animate([{ transform: t }, { transform: 'none' }], { duration: 320, easing: EASE });
	}

	// ---- HUD -----------------------------------------------------------------------------
	function toggleHud() {
		hudOn = !hudOn;
		try { localStorage.setItem('frames-hud', hudOn ? 'on' : 'off'); } catch (e) {}
		syncHud();
	}
	function syncHud() {
		root.classList.toggle('flb--hud-off', !hudOn);
		ui.hudBtn.setAttribute('aria-pressed', hudOn ? 'true' : 'false');
	}

	// ---- zoom (double-click / double-tap / pinch / ctrl+wheel) ------------------------------
	function maxScale() {
		const p = st.photos[st.index];
		const one = (p.width || st.fit.w) / (st.fit.w * (devicePixelRatio || 1)); // 100 %: one image pixel per device pixel
		return Math.max(2, one);
	}
	function applyZoom(animate) {
		const z = st.zoom;
		ui.zoom.classList.toggle('is-animating', !!animate && !reduced());
		ui.zoom.style.transform = z.s === 1 ? '' : 'translate(' + z.x.toFixed(2) + 'px,' + z.y.toFixed(2) + 'px) scale(' + z.s.toFixed(4) + ')';
		const zoomed = z.s > 1.001;
		if (zoomed !== root.classList.contains('is-zoomed') && st.fit) {
			// Phones: the zoomed photo gets the whole screen, not just the stage above the sheet
			if (zoomed) ui.scroll.scrollTop = 0;
			ui.stage.style.height = (zoomed ? st.fit.vh : st.fit.stageH) + 'px';
		}
		root.classList.toggle('is-zoomed', zoomed);
		updateChip();
	}
	function clampZoom() {
		const z = st.zoom, f = st.fit;
		const W = f.w * z.s, H = f.h * z.s;
		const view = z.s > 1.001 ? f.vh : f.stageH;
		z.x = W <= f.vw ? (f.w - W) / 2 : clamp(z.x, f.vw - f.x - W, -f.x);
		z.y = H <= view ? (f.h - H) / 2 : clamp(z.y, view - f.y - H, -f.y);
	}
	function zoomTo(s, px, py, animate) {
		const z = st.zoom;
		s = clamp(s, 1, maxScale() * 1.5);
		const cx = (px - z.x) / z.s, cy = (py - z.y) / z.s;
		z.x = px - cx * s; z.y = py - cy * s; z.s = s;
		if (s <= 1.001) { z.s = 1; z.x = z.y = 0; } else clampZoom();
		applyZoom(animate);
		if (z.s > 1) loadFull();
	}
	function resetZoom(animate) {
		if (!st) return;
		st.zoom = { s: 1, x: 0, y: 0 };
		if (ui) applyZoom(animate);
	}
	function toggleZoomAt(cx, cy) {
		const r = ui.frame.getBoundingClientRect();
		if (st.zoom.s > 1) zoomTo(1, 0, 0, true);
		else zoomTo(maxScale(), cx - r.left, cy - r.top, true);
	}
	function updateChip() {
		if (!st) return;
		const z = st.zoom;
		const p = st.photos[st.index];
		if (z.s <= 1.001) { ui.chip.textContent = ''; return; }
		const pct = Math.round(z.s * st.fit.w * (devicePixelRatio || 1) / (p.width || st.fit.w) * 100);
		ui.chip.textContent = pct + ' %' + (p.src.full && !st.fullReady ? ' · loading full resolution' : '');
	}

	function gestures() {
		const stage = ui.stage;
		const pts = new Map();
		let g = null;           // current gesture
		let lastType = 'mouse', tapTimer = 0, lastTap = null;
		const onPhoto = (x, y) => { const r = ui.frame.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
		const local = (x, y) => { const r = ui.frame.getBoundingClientRect(); return [x - r.left, y - r.top]; };
		const ignore = (t) => t.closest && t.closest('button, a');

		stage.addEventListener('pointerdown', function(ev) {
			lastType = ev.pointerType;
			if (ignore(ev.target) || busy) return;
			if (ev.pointerType === 'mouse' && (ev.button !== 0 || st.zoom.s <= 1)) return;
			pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
			try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
			const z = st.zoom;
			if (pts.size === 1) {
				g = { type: z.s > 1 ? 'pan' : 'pending', x0: ev.clientX, y0: ev.clientY, t0: ev.timeStamp, zx: z.x, zy: z.y, moved: 0, lx: ev.clientX, lt: ev.timeStamp, v: 0 };
			} else if (pts.size === 2) {
				const [a, b] = Array.from(pts.values());
				const [mx, my] = local((a.x + b.x) / 2, (a.y + b.y) / 2);
				ui.frame.style.transform = '';
				g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: z.s, cx: (mx - z.x) / z.s, cy: (my - z.y) / z.s, moved: 99 };
				ui.zoom.style.willChange = 'transform';
				loadFull();
			}
		});
		stage.addEventListener('pointermove', function(ev) {
			if (!g || !pts.has(ev.pointerId)) return;
			pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
			const z = st.zoom;
			if (g.type === 'pinch' && pts.size >= 2) {
				const [a, b] = Array.from(pts.values());
				const [mx, my] = local((a.x + b.x) / 2, (a.y + b.y) / 2);
				const s = clamp(g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0, 1, maxScale() * 1.5);
				// keep the pinched point under the fingers (frame-local coords)
				z.s = s; z.x = mx - g.cx * s; z.y = my - g.cy * s;
				clampZoom();
				applyZoom(false);
				return;
			}
			const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
			g.moved = Math.max(g.moved, Math.hypot(dx, dy));
			if (g.type === 'pan') {
				ui.zoom.style.willChange = 'transform';
				z.x = g.zx + dx; z.y = g.zy + dy;
				clampZoom();
				applyZoom(false);
			} else if (g.type === 'pending' && ev.pointerType !== 'mouse') {
				if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) g.type = 'swipe';
				else if (Math.abs(dy) > 10) g = null; // vertical: the page scrolls to the sheet
			}
			if (g && g.type === 'swipe') {
				const atEnd = (dx > 0 && st.index === 0) || (dx < 0 && st.index === st.photos.length - 1);
				ui.frame.style.transform = 'translateX(' + (atEnd ? dx * 0.3 : dx).toFixed(1) + 'px)';
				const dt = ev.timeStamp - g.lt;
				if (dt > 0) g.v = 0.7 * g.v + 0.3 * ((ev.clientX - g.lx) / dt);
				g.lx = ev.clientX; g.lt = ev.timeStamp;
			}
		});
		function end(ev) {
			if (!pts.has(ev.pointerId)) return;
			pts.delete(ev.pointerId);
			if (!g) return;
			if (g.type === 'pinch') {
				if (pts.size === 0) { ui.zoom.style.willChange = ''; if (st.zoom.s < 1.05) zoomTo(1, 0, 0, true); g = null; }
				else { const p = Array.from(pts.values())[0]; const z = st.zoom; g = { type: 'pan', x0: p.x, y0: p.y, zx: z.x, zy: z.y, moved: 99 }; }
				return;
			}
			const cancelled = ev.type === 'pointercancel';
			const dx = ev.clientX - g.x0;
			if (g.type === 'swipe') {
				const dir = dx < -60 || g.v < -0.45 ? 1 : dx > 60 || g.v > 0.45 ? -1 : 0;
				if (dir && !cancelled) go(dir, dx); else springBack();
			} else if (g.type === 'pan') {
				ui.zoom.style.willChange = '';
			}
			if (!cancelled && g.moved < 10 && ev.pointerType !== 'mouse' && ev.timeStamp - g.t0 < 400) tap(ev);
			g = null;
		}
		stage.addEventListener('pointerup', end);
		stage.addEventListener('pointercancel', end);

		// Touch taps: single tap on the photo toggles the HUD, double tap zooms, tap outside closes
		function tap(ev) {
			const x = ev.clientX, y = ev.clientY;
			if (lastTap && ev.timeStamp - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
				clearTimeout(tapTimer); lastTap = null;
				toggleZoomAt(x, y);
				return;
			}
			lastTap = { t: ev.timeStamp, x: x, y: y };
			const photo = onPhoto(x, y);
			clearTimeout(tapTimer);
			tapTimer = setTimeout(function() {
				lastTap = null;
				if (!st || root.hidden) return;
				if (photo || st.zoom.s > 1) toggleHud(); else close();
			}, 280);
		}

		// Mouse: click outside the photo closes, double-click toggles 100 %
		let downAt = null;
		stage.addEventListener('mousedown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
		stage.addEventListener('click', function(ev) {
			if (lastType !== 'mouse' || ignore(ev.target)) return;
			if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return; // was a pan
			if (!onPhoto(ev.clientX, ev.clientY) && st.zoom.s <= 1) close();
		});
		stage.addEventListener('dblclick', function(ev) {
			if (lastType !== 'mouse' || ignore(ev.target)) return;
			if (st.zoom.s > 1 || onPhoto(ev.clientX, ev.clientY)) toggleZoomAt(ev.clientX, ev.clientY);
		});
		// Trackpad pinch (ctrl+wheel) zooms; wheel pans while zoomed, else scrolls to the sheet
		stage.addEventListener('wheel', function(ev) {
			if (!st || busy) return;
			const z = st.zoom;
			if (ev.ctrlKey) {
				ev.preventDefault();
				const [px, py] = local(ev.clientX, ev.clientY);
				zoomTo(z.s * Math.exp(-ev.deltaY * 0.01), px, py, false);
			} else if (z.s > 1) {
				ev.preventDefault();
				z.x -= ev.deltaX; z.y -= ev.deltaY;
				clampZoom();
				applyZoom(false);
			}
		}, { passive: false });
	}

	// ---- keyboard + focus trap -----------------------------------------------------------
	function focusables() {
		return Array.from(root.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')).filter(function(n) {
			return !n.disabled && !n.hidden && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
		});
	}
	function onKey(ev) {
		if (!st || root.hidden || ev.defaultPrevented) return;
		if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
		if (ev.key === 'Tab') {
			const f = focusables();
			if (!f.length) return;
			const first = f[0], last = f[f.length - 1];
			if (!root.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
			else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
			else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
			return;
		}
		if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
		if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(-1); }
		else if (ev.key === 'ArrowRight') { ev.preventDefault(); go(1); }
		else if (ev.key === 'i' || ev.key === 'I') { ev.preventDefault(); toggleHud(); }
	}

	// ---- open / close with the zoom from the origin -----------------------------------------
	function visibleRect(el) {
		if (!el || !el.isConnected) return null;
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
		return r;
	}
	// Transform + clip that make the frame (at its final box f) look like the origin rect o
	function fromOrigin(o, f, radius) {
		const k = Math.max(o.width / f.w, o.height / f.h);
		const fy = f.y - ui.scroll.scrollTop;
		const tx = o.left + o.width / 2 - f.x - f.w * k / 2;
		const ty = o.top + o.height / 2 - fy - f.h * k / 2;
		const l = (o.left - (f.x + tx)) / k, t = (o.top - (fy + ty)) / k;
		const r = f.w - l - o.width / k, b = f.h - t - o.height / k;
		return {
			transform: 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + k.toFixed(5) + ')',
			clipPath: 'inset(' + [t, r, b, l].map((v) => Math.max(0, v).toFixed(2) + 'px').join(' ') + ' round ' + (radius / k).toFixed(2) + 'px)',
			box: { l: l, t: t, w: o.width / k, h: o.height / k }
		};
	}
	const radiusOf = (el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
	const DUR = 460;

	function lockPage(on) {
		const html = document.documentElement;
		const lenis = window.site && window.site.lenis;
		if (on) {
			const sb = innerWidth - html.clientWidth;
			if (sb > 0) document.body.style.paddingRight = sb + 'px';
			html.classList.add('flb-open');
			if (lenis) lenis.stop();
			inerted = Array.from(document.body.children).filter((n) => n !== root && !n.inert && n.tagName !== 'SCRIPT');
			inerted.forEach((n) => { n.inert = true; });
		} else {
			document.body.style.paddingRight = '';
			html.classList.remove('flb-open');
			if (lenis) lenis.start();
			inerted.forEach((n) => { n.inert = false; });
			inerted = [];
		}
	}

	// The reticle cursor (motion.js) re-resolves its lock target on pointerover
	function relock(el) {
		if (el) el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
	}

	function open(photos, index, opts) {
		if (!Array.isArray(photos) || !photos.length) return;
		if (!root) build();
		opts = opts || {};
		index = clamp(index | 0, 0, photos.length - 1);
		if (pendingClose) pendingClose(); // a close still animating ends now
		if (st && !root.hidden) { // already open: just switch
			st.photos = photos; st.opts = opts;
			show(index);
			return;
		}
		st = { photos: photos, index: index, opts: opts, token: 0, zoom: { s: 1, x: 0, y: 0 }, full: 0, start: index };
		lastFocus = document.activeElement;
		syncHud();
		lockPage(true);
		root.hidden = false;
		root.classList.remove('is-open', 'is-closing');
		ui.scroll.scrollTop = 0;
		show(index);
		document.addEventListener('keydown', onKey, true);

		const origin = opts.origin;
		const o = visibleRect(origin);
		const motion = !reduced();
		if (o && motion) {
			const a = fromOrigin(o, st.fit, radiusOf(origin));
			// Until w2560 decodes, the origin's own pixels fill the cropped region
			if (origin.currentSrc || origin.src) {
				ui.thumb.src = origin.currentSrc || origin.src;
				Object.assign(ui.thumb.style, { left: a.box.l + 'px', top: a.box.t + 'px', width: a.box.w + 'px', height: a.box.h + 'px' });
				ui.thumb.hidden = false;
			}
			ui.frame.style.transform = a.transform;
			ui.frame.style.clipPath = a.clipPath;
			const vis = origin.style.visibility;
			const token = st.token;
			decoded(ui.img, 180).then(function() {
				if (!st || token !== st.token) { origin.style.visibility = vis; return; }
				origin.style.visibility = 'hidden';
				root.classList.add('is-open');
				ui.frame.style.transform = ui.frame.style.clipPath = '';
				const anim = ui.frame.animate([
					{ transform: a.transform, clipPath: a.clipPath },
					{ transform: 'translate(0,0) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 0px)' }
				], { duration: DUR, easing: EASE });
				busy = anim.finished.catch(() => {}).then(function() {
					busy = null;
					origin.style.visibility = vis;
					decoded(ui.img, 4000).then(() => { if (token === st.token) ui.thumb.hidden = true; });
				});
			});
		} else {
			root.classList.add('is-open');
			if (motion) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE });
		}
		ui.close.focus({ preventScroll: true });
		relock(ui.stage);
	}

	function close() {
		if (!st || !root || root.hidden || root.classList.contains('is-closing')) return;
		const s = st;
		const opts = s.opts;
		let origin = null;
		try { origin = opts.getOrigin ? opts.getOrigin(s.index, s.photos[s.index]) : null; } catch (e) {}
		if (!origin && s.index === s.start) origin = opts.origin;
		resetZoom(false);
		ui.frame.getAnimations().forEach((a) => a.cancel());
		ui.frame.style.transform = '';
		root.classList.add('is-closing');
		root.classList.remove('is-open');
		document.removeEventListener('keydown', onKey, true);
		lockPage(false);
		const o = visibleRect(origin);
		const motion = !reduced();
		let done, restore = null;
		if (o && motion) {
			const a = fromOrigin(o, s.fit, radiusOf(origin));
			// the frame may be scrolled up with the sheet; fromOrigin accounts for scrollTop
			const vis = origin.style.visibility;
			origin.style.visibility = 'hidden';
			restore = () => { origin.style.visibility = vis; };
			ui.thumb.hidden = true;
			done = ui.frame.animate([
				{ transform: 'translate(0,0) scale(1)', clipPath: 'inset(0px 0px 0px 0px round 0px)' },
				{ transform: a.transform, clipPath: a.clipPath }
			], { duration: 380, easing: EASE, fill: 'forwards' }).finished.catch(() => {});
		} else if (motion) {
			done = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => {});
		} else {
			done = Promise.resolve();
		}
		// Runs once: when the close animation ends, or at once if open() is called meanwhile
		let finished = false;
		const finish = pendingClose = function() {
			if (finished) return;
			finished = true;
			if (pendingClose === finish) pendingClose = null;
			if (restore) restore();
			root.hidden = true;
			root.classList.remove('is-closing');
			root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
			ui.img.removeAttribute('srcset'); ui.img.removeAttribute('src');
			ui.thumb.removeAttribute('src');
			clearFull();
			if (st === s) st = null;
			if (ptr) relock(document.elementFromPoint(ptr[0], ptr[1]));
		};
		done.then(finish);
		// Focus goes back to the Tile (or whatever opened the lightbox) straight away
		const target = (origin && (origin.closest('a[href], button, [tabindex]') || origin)) || lastFocus;
		if (target && target.focus) {
			if (!target.matches('a[href], button, input, select, textarea, [tabindex]')) target.setAttribute('tabindex', '-1');
			target.focus({ preventScroll: true });
		}
		if (opts.onClose) try { opts.onClose(s.index, s.photos[s.index]); } catch (e) { console.warn(e); }
	}

	window.FramesLightbox = {
		open: open,
		close: close,
		mediaBase: null,
		get isOpen() { return !!(root && !root.hidden && !root.classList.contains('is-closing')); },
		get index() { return st ? st.index : -1; }
	};
})();
