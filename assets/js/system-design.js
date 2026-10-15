// Polaris page: system design tabs and interactive diagrams. Progressive enhancement:
// without JS (html lacks .js) every panel is shown one after another and each diagram simply reads as a picture.
(function () {
	const root = document.getElementById('s-system');
	if (!root) return;

	// ---- Tabs ----------------------------------------------------------------------------------
	const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
	const panels = tabs.map(function (t) { return document.getElementById(t.getAttribute('aria-controls')); });

	function select(tab, focus) {
		tabs.forEach(function (t, i) {
			const on = t === tab;
			t.setAttribute('aria-selected', on ? 'true' : 'false');
			t.tabIndex = on ? 0 : -1;
			if (panels[i]) panels[i].hidden = !on;
		});
		if (focus) tab.focus();
	}

	tabs.forEach(function (tab, i) {
		tab.addEventListener('click', function () { select(tab, false); });
		tab.addEventListener('keydown', function (ev) {
			let n = -1;
			if (ev.key === 'ArrowRight') n = (i + 1) % tabs.length;
			else if (ev.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
			else if (ev.key === 'Home') n = 0;
			else if (ev.key === 'End') n = tabs.length - 1;
			if (n < 0) return;
			ev.preventDefault();
			select(tabs[n], true);
		});
	});

	function fromHash() {
		const id = location.hash.slice(1);
		const i = panels.findIndex(function (p) { return p && p.id === id; });
		if (i >= 0) {
			select(tabs[i], false);
			requestAnimationFrame(function () { panels[i].scrollIntoView({ block: 'start' }); });
			return true;
		}
		return false;
	}
	window.addEventListener('hashchange', fromHash);
	if (!fromHash()) {
		panels.forEach(function (p, i) { if (p) p.hidden = i !== 0; });
	}

	// ---- Diagrams: hover or focus a part to light up its connections and change the text beneath ----
	// Each figure.diagram holds .sd-node groups (data-id, data-rel, data-detail) and .sd-line paths (data-ends).
	// data-rel="*" means "highlight only this part" (used by nested rings and timelines).
	document.querySelectorAll('figure.diagram').forEach(function (figure) {
		const svg = figure.querySelector('svg');
		const detail = figure.querySelector('.sd-detail');
		if (!svg || !detail) return;
		const nodes = Array.from(svg.querySelectorAll('.sd-node'));
		if (!nodes.length) return;
		const lines = Array.from(svg.querySelectorAll('.sd-line'));
		const idle = detail.textContent;

		function activate(node) {
			const rel = node.dataset.rel || '';
			const solo = rel.trim() === '*';
			const on = new Set([node.dataset.id].concat(solo ? [] : rel.split(' ').filter(Boolean)));
			nodes.forEach(function (n) {
				const hit = solo || on.has(n.dataset.id);
				n.classList.toggle('is-active', n === node);
				n.classList.toggle('is-on', hit && n !== node && !solo);
				n.classList.toggle('is-dim', !hit);
			});
			lines.forEach(function (l) {
				const ends = (l.dataset.ends || '').split(' ').filter(Boolean);
				const own = lines.some(function (x) { return (x.dataset.ends || '').split(' ').indexOf(node.dataset.id) >= 0; });
				const hit = !solo && ends.length > 0 && ends.every(function (e) { return on.has(e); }) &&
					(!own || ends.indexOf(node.dataset.id) >= 0);
				l.classList.toggle('is-on', hit);
				l.classList.toggle('is-dim', !hit);
			});
			figure.classList.add('is-focus');
			detail.textContent = node.dataset.detail || idle;
		}
		function clear() {
			figure.classList.remove('is-focus');
			nodes.concat(lines).forEach(function (n) { n.classList.remove('is-on', 'is-dim', 'is-active'); });
			detail.textContent = idle;
		}

		nodes.forEach(function (n) {
			n.addEventListener('mouseenter', function () { activate(n); });
			n.addEventListener('focus', function () { activate(n); });
			n.addEventListener('click', function () { activate(n); });
			n.addEventListener('blur', clear);
		});
		svg.addEventListener('mouseleave', clear);
	});
})();
