// Project pages: click-to-load YouTube embeds, and pager thumbnails that morph into the next hero.
(function() {
	// Thumbnail until the visitor presses play (ported from video.js)
	document.querySelectorAll('.yt-embed').forEach(function(box) {
		const link = box.querySelector('a');
		if (!link || !box.dataset.id) return;
		link.addEventListener('click', function(ev) {
			if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return; // let new-tab clicks through
			ev.preventDefault();
			const iframe = document.createElement('iframe');
			iframe.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(box.dataset.id) + '?autoplay=1';
			iframe.title = box.dataset.title || 'YouTube video';
			iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
			iframe.allowFullscreen = true;
			box.replaceChildren(iframe);
			box.classList.add('is-playing');
			iframe.focus();
		});
	});

	// Prev/next: hand the hero's view-transition-name to the clicked thumbnail,
	// so it morphs into the destination hero instead of the current one.
	const hero = document.querySelector('.proj-hero__media img');
	function reset() {
		if (hero) hero.style.viewTransitionName = hero.dataset.vt || '';
		document.querySelectorAll('.proj-pager__link img[data-vt]').forEach(function(img) { img.style.viewTransitionName = ''; });
	}
	if (hero) hero.dataset.vt = hero.style.viewTransitionName;
	document.querySelectorAll('.proj-pager__link').forEach(function(link) {
		link.addEventListener('click', function(ev) {
			if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
			const img = link.querySelector('img[data-vt]');
			if (!img) return;
			if (hero) hero.style.viewTransitionName = 'none';
			img.style.viewTransitionName = img.dataset.vt;
		});
	});
	// Back/forward cache restores the swapped names; put them back
	window.addEventListener('pageshow', function(ev) { if (ev.persisted) reset(); });
})();
