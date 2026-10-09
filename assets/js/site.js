// Shared behaviour for redesigned pages: theme, nav, mobile menu, font preview.
(function() {
	'use strict';
	const root = document.documentElement;
	root.classList.add('js');

	// Font preview (?font=geist) — temporary, for choosing a typeface.
	if (new URLSearchParams(location.search).get('font') === 'geist') root.dataset.font = 'geist';

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
