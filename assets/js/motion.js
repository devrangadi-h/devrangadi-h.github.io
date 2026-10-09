// Motion layer: reveals, spotlight, reticle cursor, magnetic CTAs, Lenis,
// counters, typewriter. Each feature switches itself off for reduced motion,
// touch, or a missing library; content is always readable without it.
(function() {
	'use strict';
	const root = document.documentElement;
	const site = window.site || {};
	const reduced = site.reducedMotion ? site.reducedMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches;
	const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
	const hover = matchMedia('(hover: hover)').matches;
	const touch = site.isTouch != null ? site.isTouch : !hover;
	const gsap = window.gsap;
	const ST = window.ScrollTrigger;
	const EASE = 'power4.out'; // ≈ --ease cubic-bezier(0.22, 1, 0.36, 1)
	const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
	if (reduced) return; // CSS leaves everything visible; counters/typewriter keep final text

	root.classList.add('motion');
	if (gsap && ST) gsap.registerPlugin(ST);

	// Reveals: fade + 12px rise once; groups stagger children 60ms
	(function reveals() {
		const singles = Array.from(document.querySelectorAll('[data-reveal]'));
		const groups = Array.from(document.querySelectorAll('[data-reveal-group]'));
		function done(els) {
			els.forEach(function(el) { el.classList.add('is-revealed'); });
			if (gsap) gsap.set(els, { clearProps: 'opacity,transform' });
		}
		function show(els) {
			if (!gsap) { done(els); return; }
			gsap.fromTo(els, { opacity: 0, y: 12 }, {
				opacity: 1, y: 0, duration: 0.7, ease: EASE, stagger: 0.06,
				onComplete: function() { done(els); }
			});
		}
		if (!('IntersectionObserver' in window)) {
			done(singles.concat(groups.flatMap(function(g) { return Array.from(g.children); })));
			return;
		}
		const io = new IntersectionObserver(function(entries) {
			entries.forEach(function(e) {
				if (!e.isIntersecting) return;
				io.unobserve(e.target);
				show(e.target.hasAttribute('data-reveal-group') ? Array.from(e.target.children) : [e.target]);
			});
		}, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
		singles.forEach(function(el) { if (!el.parentElement.hasAttribute('data-reveal-group')) io.observe(el); });
		groups.forEach(function(g) { io.observe(g); });
	})();

	// Counters: 0 → n once when half visible
	(function counters() {
		const els = document.querySelectorAll('[data-counter]');
		if (!els.length || !('IntersectionObserver' in window)) return;
		const io = new IntersectionObserver(function(entries) {
			entries.forEach(function(e) {
				if (!e.isIntersecting) return;
				io.unobserve(e.target);
				run(e.target);
			});
		}, { threshold: 0.5 });
		function fmt(el, v) {
			const dec = (el.dataset.counter.split('.')[1] || '').length;
			el.textContent = v.toFixed(dec) + (el.dataset.counterSuffix || '');
		}
		function run(el) {
			const end = parseFloat(el.dataset.counter);
			const dur = 1400;
			const t0 = performance.now();
			(function step(now) {
				const t = clamp((now - t0) / dur, 0, 1);
				fmt(el, end * (1 - Math.pow(1 - t, 4)));
				if (t < 1) requestAnimationFrame(step);
				else fmt(el, end);
			})(t0);
		}
		els.forEach(function(el) {
			if (isNaN(parseFloat(el.dataset.counter))) return;
			el.setAttribute('aria-label', el.textContent.trim());
			fmt(el, 0);
			io.observe(el);
		});
	})();

	// Typewriter for [data-typewriter], triggered by polaris-live.js
	(function typewriter() {
		const timers = new WeakMap();
		document.addEventListener('polaris:latest', function(ev) {
			const el = ev.detail && ev.detail.el;
			if (!el || !el.hasAttribute('data-typewriter')) return;
			clearInterval(timers.get(el));
			const text = el.textContent;
			if (!text.trim()) return;
			const step = Math.max(1, Math.round(text.length / 60)); // cap ≈1.2s total
			let i = 0;
			el.setAttribute('aria-label', text);
			el.classList.add('is-typing');
			el.textContent = '';
			timers.set(el, setInterval(function() {
				i = Math.min(text.length, i + step);
				el.textContent = text.slice(0, i);
				if (i >= text.length) {
					clearInterval(timers.get(el));
					el.classList.remove('is-typing');
					el.removeAttribute('aria-label');
				}
			}, 20));
		});
	})();

	// Card spotlight: --mx/--my on the hovered tile, rAF-throttled
	if (hover) (function spotlight() {
		let tile = null, x = 0, y = 0, queued = false;
		document.addEventListener('pointermove', function(ev) {
			if (ev.pointerType === 'touch') return;
			tile = ev.target.closest && ev.target.closest('.tile');
			if (!tile) return;
			x = ev.clientX; y = ev.clientY;
			if (queued) return;
			queued = true;
			requestAnimationFrame(function() {
				queued = false;
				if (!tile) return;
				const r = tile.getBoundingClientRect();
				tile.style.setProperty('--mx', (x - r.left).toFixed(1) + 'px');
				tile.style.setProperty('--my', (y - r.top).toFixed(1) + 'px');
			});
		}, { passive: true });
	})();

	// Magnetic CTAs: pull ≤8px toward the pointer, spring back with a small overshoot.
	// Uses the `translate` property so :active scale (transform) still composes.
	if (fine) (function magnetic() {
		const MAX = 8;
		const items = [];
		let running = false, last = 0;
		document.querySelectorAll('[data-magnetic]').forEach(function(el) {
			const s = { el: el, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
			items.push(s);
			el.addEventListener('pointermove', function(ev) {
				const r = el.getBoundingClientRect();
				const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
				const dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
				s.tx = clamp(dx, -1, 1) * MAX;
				s.ty = clamp(dy, -1, 1) * MAX * 0.6;
				kick();
			});
			el.addEventListener('pointerleave', function() { s.tx = 0; s.ty = 0; kick(); });
		});
		function kick() {
			if (running) return;
			running = true; last = performance.now();
			requestAnimationFrame(tick);
		}
		function tick(now) {
			const dt = Math.min(0.032, (now - last) / 1000); last = now;
			let busy = false;
			items.forEach(function(s) {
				// Damped spring: k=220, c=18 → ζ≈0.6, settles in ~0.5s
				const ax = 220 * (s.tx - s.x) - 18 * s.vx;
				const ay = 220 * (s.ty - s.y) - 18 * s.vy;
				s.vx += ax * dt; s.vy += ay * dt;
				s.x += s.vx * dt; s.y += s.vy * dt;
				if (Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y) + Math.abs(s.vx) + Math.abs(s.vy) > 0.02) busy = true;
				else { s.x = s.tx; s.y = s.ty; s.vx = s.vy = 0; }
				s.el.style.translate = (s.x || s.y) ? s.x.toFixed(2) + 'px ' + s.y.toFixed(2) + 'px' : '';
			});
			if (busy) requestAnimationFrame(tick);
			else running = false;
		}
	})();

	// Reticle cursor: crosshair that follows the pointer; four corner brackets
	// lock onto the hovered control's box (and radius) and tighten on acquire.
	if (fine) (function reticle() {
		const LOCK = 'a[href], button, [data-shape], .tile--link, input[type="range"], [data-cursor="lock"], summary';
		const NATIVE = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable=""], [contenteditable="true"]';
		const IDLE = 11; // half-size of the idle box
		const el = document.createElement('div');
		el.className = 'reticle';
		el.setAttribute('aria-hidden', 'true');
		el.innerHTML = '<span class="reticle__cross"></span><span class="reticle__dot"></span>' +
			'<span class="reticle__c reticle__c--tl"></span><span class="reticle__c reticle__c--tr"></span>' +
			'<span class="reticle__c reticle__c--bl"></span><span class="reticle__c reticle__c--br"></span>';
		document.body.appendChild(el);
		root.classList.add('has-reticle');
		const cross = el.querySelector('.reticle__cross');
		const dot = el.querySelector('.reticle__dot');
		const corners = Array.from(el.querySelectorAll('.reticle__c'));
		// Corner positions (x, y) smoothed toward targets: tl, tr, bl, br
		const cur = [0, 0, 0, 0, 0, 0, 0, 0];
		let px = -100, py = -100, dx = -100, dy = -100;
		let target = null, radius = 0, pad = 4, press = 0, visible = false, first = true;
		let last = performance.now(), raf = 0, lastLock = 0;

		function setRadius(r) {
			corners.forEach(function(c) { c.style.setProperty('--r', r + 'px'); });
		}
		function lock(t) {
			if (t === target) return;
			target = t;
			el.classList.toggle('is-locked', !!t);
			if (t) {
				const r = t.getBoundingClientRect();
				const cr = parseFloat(getComputedStyle(t).borderTopLeftRadius) || 0;
				radius = Math.min(cr + 4, 10, r.height / 2 + 4);
				pad = 10; // starts loose, tightens to 4
				lastLock = performance.now();
			} else {
				radius = 0;
			}
			setRadius(radius);
			wake();
		}
		function resolve(node) {
			if (!node || !node.closest) return null;
			if (node.closest(NATIVE)) return 'native';
			const t = node.closest(LOCK);
			if (t && t.getAttribute('aria-disabled') !== 'true' && !t.disabled) return t;
			return null;
		}
		function update(node) {
			const t = resolve(node);
			el.classList.toggle('is-native', t === 'native');
			lock(t === 'native' ? null : t);
		}
		function show(v) {
			if (v === visible) return;
			visible = v;
			el.classList.toggle('is-visible', v);
		}
		document.addEventListener('pointermove', function(ev) {
			if (ev.pointerType === 'touch') { show(false); return; }
			px = ev.clientX; py = ev.clientY;
			if (first) { first = false; dx = px; dy = py; snapIdle(); }
			show(true);
			wake();
		}, { passive: true });
		document.addEventListener('pointerover', function(ev) { if (ev.pointerType !== 'touch') update(ev.target); }, { passive: true });
		document.addEventListener('pointerdown', function() { press = 1; wake(); }, { passive: true });
		document.addEventListener('pointerup', function() { press = 0; wake(); }, { passive: true });
		document.documentElement.addEventListener('pointerleave', function() { show(false); lock(null); });
		window.addEventListener('blur', function() { show(false); });
		// Scrolling moves content under a still pointer: re-resolve the target
		let scrollQueued = false;
		window.addEventListener('scroll', function() {
			if (scrollQueued || first) return;
			scrollQueued = true;
			requestAnimationFrame(function() {
				scrollQueued = false;
				update(document.elementFromPoint(px, py));
				wake();
			});
		}, { passive: true });

		function snapIdle() {
			for (let i = 0; i < 4; i++) {
				cur[i * 2] = px + (i % 2 ? IDLE : -IDLE);
				cur[i * 2 + 1] = py + (i > 1 ? IDLE : -IDLE);
			}
		}
		function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
		function frame(now) {
			raf = 0;
			const dt = Math.min(0.05, (now - last) / 1000); last = now;
			const fFollow = 1 - Math.exp(-dt * 28); // ~35ms lag on the crosshair
			const fCorner = 1 - Math.exp(-dt * (target ? 20 : 26));
			dx += (px - dx) * fFollow; dy += (py - dy) * fFollow;
			let box;
			if (target) {
				const r = target.getBoundingClientRect();
				if (!r.width || !target.isConnected) { lock(null); }
				else {
					pad += (4 - pad) * (1 - Math.exp(-dt * 9));
					const p = pad - press * 2;
					box = [r.left - p, r.top - p, r.right + p, r.bottom + p];
				}
			}
			if (!box) {
				const s = IDLE - press * 3;
				box = [dx - s, dy - s, dx + s, dy + s];
			}
			const tx = [box[0], box[1], box[2], box[1], box[0], box[3], box[2], box[3]];
			let moving = Math.abs(px - dx) + Math.abs(py - dy) > 0.1;
			for (let i = 0; i < 8; i++) {
				cur[i] += (tx[i] - cur[i]) * fCorner;
				if (Math.abs(tx[i] - cur[i]) > 0.1) moving = true;
			}
			corners.forEach(function(c, i) {
				c.style.transform = 'translate3d(' + cur[i * 2].toFixed(2) + 'px,' + cur[i * 2 + 1].toFixed(2) + 'px,0)';
			});
			const pos = 'translate3d(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px,0)';
			cross.style.transform = pos;
			dot.style.transform = pos;
			// Keep tracking while locked (target may move: hover lift, magnetic pull)
			if (moving || target && now - lastLock < 1500 || target && target.matches('[data-magnetic]')) raf = requestAnimationFrame(frame);
		}
	})();

	// Lenis smooth scroll (desktop only), wired into ScrollTrigger
	if (window.Lenis && !touch) (function smooth() {
		const lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
		site.lenis = lenis;
		if (gsap) {
			if (ST) lenis.on('scroll', ST.update);
			gsap.ticker.add(function(t) { lenis.raf(t * 1000); });
			gsap.ticker.lagSmoothing(0);
		} else {
			(function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
		}
		const home = /^\/(index\.html)?$/.test(location.pathname);
		const nav = document.querySelector('[data-nav]');
		document.addEventListener('click', function(ev) {
			if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
			const a = ev.target.closest && ev.target.closest('a[href^="#"], a[href^="/#"]');
			if (!a || a.classList.contains('skip-link')) return;
			const href = a.getAttribute('href');
			if (href.charAt(0) === '/' && !home) return;
			const hash = href.slice(href.indexOf('#'));
			const dest = hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
			if (!dest && hash !== '#') return;
			ev.preventDefault();
			lenis.scrollTo(dest || 0, { offset: dest ? -(nav ? nav.offsetHeight : 0) : 0, duration: 1.1, easing: function(t) { return 1 - Math.pow(1 - t, 4); } });
			if (dest) {
				history.pushState(null, '', hash);
				if (!dest.hasAttribute('tabindex') && !dest.matches('a, button, input, select, textarea')) dest.setAttribute('tabindex', '-1');
				dest.focus({ preventScroll: true });
			}
		});
	})();
})();
