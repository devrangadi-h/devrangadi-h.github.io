// Shared dark/light theme toggle. Dark is the default on every page.
(function() {
	const body = document.body;
	let stored = null;
	try { stored = localStorage.getItem('theme'); } catch (e) {}
	if (stored !== 'light') body.classList.add('theme-dark');
	const btn = document.getElementById('theme-toggle');
	if (!btn) return;
	const icon = btn.querySelector('.theme-icon');
	function refresh() {
		const dark = body.classList.contains('theme-dark');
		if (icon) icon.textContent = dark ? '☀︎' : '☾';
	}
	btn.addEventListener('click', function() {
		body.classList.toggle('theme-dark');
		const dark = body.classList.contains('theme-dark');
		try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) {}
		refresh();
	});
	refresh();
})();
