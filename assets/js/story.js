// Frames Story pages: photos open the shared lightbox, clips autoplay in view,
// YouTube loads on click, the next-story thumbnail morphs into the next hero.
(function() {
	'use strict';
	const reduced = window.site && window.site.reducedMotion ? window.site.reducedMotion() : matchMedia('(prefers-reduced-motion: reduce)').matches;
	const story = document.querySelector('.story');

	let photos = [];
	try { photos = JSON.parse(document.getElementById('story-photos').textContent) || []; } catch (e) { photos = []; }

	function setRatio(el, w, h) {
		if (w > 0 && h > 0 && !el.style.getPropertyValue('--ar')) el.style.setProperty('--ar', (w / h).toFixed(4));
	}

	// Aspect ratios feed the CSS: equal-height rows and height-capped portraits
	document.querySelectorAll('.story-figure').forEach(function(fig) {
		const img = fig.querySelector('img');
		if (img) setRatio(fig, +img.getAttribute('width'), +img.getAttribute('height'));
	});

	// Lightbox: every [data-photo-index] (hero cover and figures)
	function open(index, img, trigger) {
		const lb = window.FramesLightbox;
		if (!photos[index]) return;
		if (lb && typeof lb.open === 'function') {
			lb.open(photos, index, { origin: img, mediaBase: (document.querySelector('.story[data-media-base]') || {}).dataset?.mediaBase, onClose: function() { if (trigger && trigger.focus) trigger.focus({ preventScroll: true }); } });
			return;
		}
		// No lightbox script: show the large file on its own
		const base = story ? story.dataset.mediaBase : '';
		const src = photos[index].src && (photos[index].src.w2560 || photos[index].src.w1280);
		if (src) location.href = base.replace(/\/$/, '') + '/' + src;
	}

	document.querySelectorAll('[data-photo-index]').forEach(function(el) {
		const index = parseInt(el.getAttribute('data-photo-index'), 10);
		if (isNaN(index)) return;
		const img = el.tagName === 'IMG' ? el : el.querySelector('img');
		if (!img) return;
		let trigger = el.querySelector('button') || el;
		// The cover is a bare <img>: make it a keyboard-reachable control
		if (trigger === img) {
			img.setAttribute('role', 'button');
			img.tabIndex = 0;
			img.setAttribute('aria-label', 'Open cover photo' + (img.alt ? ': ' + img.alt : ''));
			img.addEventListener('keydown', function(ev) {
				if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(index, img, img); }
			});
		}
		trigger.addEventListener('click', function(ev) {
			ev.preventDefault();
			open(index, img, trigger);
		});
	});

	// Clips: muted loops play only while on screen; reduced motion gets controls
	const clips = Array.from(document.querySelectorAll('.story-clip video'));
	clips.forEach(function(v) { setRatio(v.closest('.story-clip'), +v.getAttribute('width'), +v.getAttribute('height')); });
	if (reduced || !('IntersectionObserver' in window)) {
		clips.forEach(function(v) { v.controls = true; v.autoplay = false; v.preload = 'none'; });
	} else if (clips.length) {
		const io = new IntersectionObserver(function(entries) {
			entries.forEach(function(e) {
				const v = e.target;
				if (e.isIntersecting && !v.dataset.userPaused) {
					v.preload = 'auto';
					const p = v.play();
					if (p && p.catch) p.catch(function() { v.controls = true; });
				} else if (!e.isIntersecting && !v.paused) {
					v.pause();
				}
			});
		}, { threshold: 0.35 });
		clips.forEach(function(v) {
			v.muted = true;
			v.defaultMuted = true;
			v.loop = true;
			v.playsInline = true;
			v.controls = false;
			// Wrap so the pause control can sit over the video
			const frame = document.createElement('div');
			frame.className = 'story-clip__frame';
			v.parentNode.insertBefore(frame, v);
			frame.appendChild(v);
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'story-clip__toggle';
			btn.setAttribute('aria-pressed', 'false');
			btn.textContent = 'Pause';
			btn.setAttribute('aria-label', 'Pause clip');
			frame.appendChild(btn);
			btn.addEventListener('click', function() {
				if (v.paused) {
					delete v.dataset.userPaused;
					v.play();
				} else {
					v.dataset.userPaused = '1';
					v.pause();
				}
			});
			function sync() {
				const paused = v.paused;
				btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
				btn.textContent = paused ? 'Play' : 'Pause';
				btn.setAttribute('aria-label', paused ? 'Play clip' : 'Pause clip');
			}
			v.addEventListener('play', sync);
			v.addEventListener('pause', sync);
			sync();
			io.observe(v);
		});
	}

	// YouTube: thumbnail link until the visitor presses play (as on project pages)
	document.querySelectorAll('.story-video.yt-embed').forEach(function(box) {
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

	// Next story: hand the hero's view-transition-name to the pager thumbnail
	// so it morphs into the next story's hero instead of this one.
	const hero = document.querySelector('.story-hero__img');
	const next = document.querySelector('.story-pager__next');
	if (hero) hero.dataset.vt = hero.style.viewTransitionName;
	if (next) {
		const m = /\/frames\/([^/?#]+)\.html/.exec(next.getAttribute('href') || '');
		const thumb = next.querySelector('img');
		if (m && thumb) {
			next.addEventListener('click', function(ev) {
				if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
				if (hero) hero.style.viewTransitionName = 'none';
				thumb.style.viewTransitionName = 'frame-' + m[1];
			});
		}
	}
	window.addEventListener('pageshow', function(ev) {
		if (!ev.persisted) return;
		if (hero) hero.style.viewTransitionName = hero.dataset.vt || '';
		const thumb = next && next.querySelector('img');
		if (thumb) thumb.style.viewTransitionName = '';
	});
})();
