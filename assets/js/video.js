// Click-to-load YouTube embeds: show a thumbnail until the visitor presses play.
(function() {
	document.querySelectorAll('.yt-embed').forEach(function(box) {
		const link = box.querySelector('a');
		if (!link) return;
		link.addEventListener('click', function(ev) {
			ev.preventDefault();
			const iframe = document.createElement('iframe');
			iframe.src = 'https://www.youtube-nocookie.com/embed/' + box.dataset.id + '?autoplay=1';
			iframe.title = box.dataset.title || 'YouTube video';
			iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
			iframe.allowFullscreen = true;
			box.replaceChildren(iframe);
		});
	});
})();
