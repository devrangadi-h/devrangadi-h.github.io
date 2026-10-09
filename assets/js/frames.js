// Frames grid: Photo Tiles open the lightbox (hash #slug), Story Tiles navigate
// (their cover morphs into the Story hero via view transitions). Without JS the
// Tiles are plain links and #slug simply does nothing.
(function() {
	'use strict';
	const grid = document.querySelector('.frames-grid');
	if (!grid || !window.FramesLightbox) return;
	const LB = window.FramesLightbox;
	const tiles = () => Array.from(grid.querySelectorAll('.frame-tile'));
	const tileFor = (slug) => tiles().find((t) => t.dataset.slug === slug) || null;
	const imgFor = (slug) => { const t = tileFor(slug); return t && t.querySelector('img'); };
	const slugFromHash = () => { try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; } };

	// Photo objects in grid order (Stories open their own page)
	let photos = null, base = '/_media/frames';
	const data = fetch('/frames.json', { credentials: 'same-origin' })
		.then((r) => { if (!r.ok) throw new Error('frames.json ' + r.status); return r.json(); })
		.then(function(json) {
			base = json.mediaBase || base;
			const bySlug = new Map(json.items.filter((it) => it.type === 'photo').map((it) => [it.slug, it]));
			photos = tiles().filter((t) => t.dataset.type === 'photo').map((t) => bySlug.get(t.dataset.slug)).filter(Boolean);
			return photos;
		})
		.catch(function(e) { console.warn('Frames:', e.message); return null; });

	const url = () => location.pathname + location.search;
	let pushed = false;

	function openSlug(slug, how) {
		return data.then(function(list) {
			if (!list) return false;
			const i = list.findIndex((p) => p.slug === slug);
			if (i < 0) return false;
			if (LB.isOpen) { LB.open(list, i, opts(i)); return true; }
			const img = imgFor(slug);
			if (how === 'load' && img) {
				// Bring the Tile on screen so closing zooms back into it
				const r = img.getBoundingClientRect();
				if (r.top < 0 || r.bottom > innerHeight) {
					const y = scrollY + r.top - (innerHeight - r.height) / 2;
					window.scrollTo({ top: y, behavior: 'instant' });
					if (window.site && window.site.lenis) window.site.lenis.scrollTo(y, { immediate: true, force: true });
				}
			}
			LB.open(list, i, opts(i, img));
			return true;
		});
	}
	function opts(i, img) {
		return {
			origin: img,
			mediaBase: base,
			getOrigin: (_, p) => imgFor(p.slug),
			onChange: function(_, p) { history.replaceState(history.state, '', '#' + encodeURIComponent(p.slug)); },
			onClose: function() {
				if (pushed && history.state && history.state.frames) { pushed = false; history.back(); }
				else history.replaceState(null, '', url());
			}
		};
	}

	// Tile clicks: Photos open in place; Stories (and modified clicks) navigate normally
	grid.addEventListener('click', function(ev) {
		const tile = ev.target.closest('.frame-tile');
		if (!tile || tile.dataset.type !== 'photo') return;
		if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
		ev.preventDefault();
		const slug = tile.dataset.slug;
		openSlug(slug, 'click').then(function(ok) {
			if (!ok) return;
			history.pushState({ frames: slug }, '', '#' + encodeURIComponent(slug));
			pushed = true;
		});
	});

	// Back/forward and hand-edited hashes
	function sync() {
		const slug = slugFromHash();
		if (!slug) { if (LB.isOpen) { pushed = false; LB.close(); } return; }
		if (LB.isOpen && photos && photos[LB.index] && photos[LB.index].slug === slug) return;
		openSlug(slug, 'load');
	}
	window.addEventListener('popstate', sync);
	window.addEventListener('hashchange', sync);
	if (location.hash.length > 1) {
		const go = () => openSlug(slugFromHash(), 'load');
		if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
	}

	// Story navigation: only the clicked Tile keeps its view-transition-name
	window.addEventListener('pageswap', function(ev) {
		if (!ev.viewTransition || !ev.activation || !ev.activation.entry) return;
		const dest = new URL(ev.activation.entry.url, location.href).pathname;
		tiles().forEach(function(t) {
			const img = t.querySelector('img');
			if (!img) return;
			const match = t.dataset.type === 'story' && new URL(t.href, location.href).pathname === dest;
			img.style.viewTransitionName = match ? 'frame-' + t.dataset.slug : 'none';
		});
	});
	// Restored from the back/forward cache: put the names back
	window.addEventListener('pageshow', function(ev) {
		if (!ev.persisted) return;
		tiles().forEach(function(t) { const img = t.querySelector('img'); if (img) img.style.viewTransitionName = 'frame-' + t.dataset.slug; });
	});
})();
