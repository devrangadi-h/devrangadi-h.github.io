// Shared behaviour for redesigned pages: theme, nav, mobile menu.
(function() {
	'use strict';
	const root = document.documentElement;
	root.classList.add('js');

	// Theme
	const darkMq = matchMedia('(prefers-color-scheme: dark)');
	function effectiveTheme() {
		const t = root.dataset.theme;
		if (t === 'light' || t === 'dark') return t;
		return darkMq.matches ? 'dark' : 'light';
	}
	const toggles = document.querySelectorAll('[data-theme-toggle]');
	function refreshTheme() {
		const theme = effectiveTheme();
		const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
		toggles.forEach(function(btn) { btn.setAttribute('aria-label', label); });
		document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
	}
	toggles.forEach(function(btn) {
		btn.addEventListener('click', function() {
			const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
			root.dataset.theme = next;
			try { localStorage.setItem('theme', next); } catch (e) {}
			refreshTheme();
		});
	});
	// Follow the system live until the visitor picks a theme explicitly.
	darkMq.addEventListener('change', function() {
		const t = root.dataset.theme;
		if (t !== 'light' && t !== 'dark') refreshTheme();
	});
	refreshTheme();

	window.site = {
		reducedMotion: function() { return matchMedia('(prefers-reduced-motion: reduce)').matches; },
		isTouch: matchMedia('(hover: none)').matches,
		theme: effectiveTheme
	};

	// A small extra, loaded only on request: a typed word (kept as an FNV-1a hash) or five quick taps on the footer credit.
	const eggSrc = document.currentScript && document.currentScript.src;
	let eggBusy = false;
	function egg() {
		if (eggBusy || !eggSrc) return;
		eggBusy = true;
		import(new URL('egg.js', eggSrc).href).then(function(m) { return m.default(); })
			.catch(function(e) { console.warn('egg:', e); })
			.then(function() { eggBusy = false; });
	}
	function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
	let typed = '', typedAt = 0;
	document.addEventListener('keydown', function(ev) {
		const t = ev.target;
		if (ev.key.length !== 1 || ev.ctrlKey || ev.metaKey || ev.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
		if (ev.timeStamp - typedAt > 2000) typed = '';
		typedAt = ev.timeStamp;
		typed = (typed + ev.key.toLowerCase()).slice(-12);
		for (let n = 4; n <= typed.length; n++) if (fnv(typed.slice(-n)) === 0xe3a38b41) { typed = ''; egg(); }
	});
	const credit = document.querySelector('.site-footer span');
	if (credit) {
		let taps = 0, tapAt = 0;
		credit.addEventListener('mousedown', function(ev) { if (ev.detail > 1) ev.preventDefault(); });
		credit.addEventListener('click', function(ev) {
			taps = ev.timeStamp - tapAt < 600 ? taps + 1 : 1;
			tapAt = ev.timeStamp;
			if (taps >= 5) { taps = 0; egg(); }
		});
	}

	const nav = document.querySelector('[data-nav]');
	if (!nav) return;

	// aria-current: "/" and "/index.html" are the same page; hash links don't count.
	function normPath(p) { return p.replace(/\/index\.html$/, '/'); }
	const here = normPath(location.pathname);
	nav.querySelectorAll('.site-nav__links a[href]').forEach(function(link) {
		if (link.hash || link.origin !== location.origin) return;
		if (normPath(link.pathname) === here) link.setAttribute('aria-current', 'page');
	});

	// Mobile menu
	const menuBtn = nav.querySelector('[data-nav-toggle]');
	function isOpen() { return nav.classList.contains('is-open'); }
	function setOpen(open, returnFocus) {
		nav.classList.toggle('is-open', open);
		if (open) nav.classList.remove('is-hidden');
		if (!menuBtn) return;
		menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
		menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
		if (!open && returnFocus) menuBtn.focus();
	}
	if (menuBtn) {
		menuBtn.addEventListener('click', function() { setOpen(!isOpen()); });
		document.addEventListener('keydown', function(ev) {
			if (ev.key === 'Escape' && isOpen()) setOpen(false, true);
		});
		document.addEventListener('click', function(ev) {
			if (isOpen() && !nav.contains(ev.target)) setOpen(false);
		});
		nav.querySelectorAll('.site-nav__links a').forEach(function(link) {
			link.addEventListener('click', function() { if (isOpen()) setOpen(false); });
		});
		const wideMq = matchMedia('(min-width: 720px)');
		wideMq.addEventListener('change', function() {
			if (wideMq.matches && isOpen()) setOpen(false);
		});
	}

	// Nav scroll: translucent once scrolled, hide on scroll down, show on scroll up.
	let lastY = window.scrollY;
	let ticking = false;
	function onScroll() {
		ticking = false;
		const y = Math.max(window.scrollY, 0);
		const delta = y - lastY;
		nav.classList.toggle('is-scrolled', y > 8);
		if (delta < 0) {
			nav.classList.remove('is-hidden');
		} else if (delta > 4 && y > nav.offsetHeight && !isOpen() && !nav.contains(document.activeElement)) {
			nav.classList.add('is-hidden');
		}
		// Small downward jitter accumulates until it passes the threshold.
		if (delta < 0 || delta > 4) lastY = y;
	}
	window.addEventListener('scroll', function() {
		if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
	}, { passive: true });
	// Keyboard users tabbing into a hidden nav should see it.
	nav.addEventListener('focusin', function() { nav.classList.remove('is-hidden'); });
	onScroll();
})();
