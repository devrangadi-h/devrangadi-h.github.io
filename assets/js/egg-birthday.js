// Birthday variant of the egg. Active for the whole of 20 October in the visitor's own time zone.
// The heart sequence from egg.js plays first; this adds the cake, a waving robot and confetti.
export const BIRTH = { month: 9, day: 20, year: 2001 };

export function birthday(now = new Date()) {
	if (now.getMonth() !== BIRTH.month || now.getDate() !== BIRTH.day) return null;
	return { age: now.getFullYear() - BIRTH.year };
}

const NOTES = ['✦ Happy {n} birthday, Shivani. Every robot needs a North Star. Mine is you.'];

export function ordinal(n) {
	const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function noteText(age) { return NOTES[0].replace('{n}', ordinal(age)); }

const svg = (age) => `
<svg viewBox="0 0 400 290" role="presentation" focusable="false">
	<g class="bd-robot">
		<line x1="76" y1="108" x2="76" y2="126" class="bd-stroke"/><circle cx="76" cy="104" r="5" class="bd-dot"/>
		<path d="M54 128 L76 84 L98 128 Z" class="bd-hat"/><circle cx="76" cy="82" r="5" class="bd-dot"/>
		<rect x="44" y="126" width="64" height="50" rx="13" class="bd-body"/>
		<circle cx="64" cy="150" r="6" class="bd-eye"/><circle cx="88" cy="150" r="6" class="bd-eye"/>
		<path d="M64 164 Q76 172 88 164" class="bd-smile"/>
		<rect x="36" y="182" width="80" height="70" rx="16" class="bd-body"/>
		<rect x="62" y="200" width="28" height="18" rx="5" class="bd-panel"/>
		<g class="bd-wave"><rect x="104" y="190" width="54" height="13" rx="6.5" class="bd-body"/></g>
	</g>
	<g class="bd-cake">
		<rect x="166" y="196" width="190" height="64" rx="12" class="bd-tier"/>
		<rect x="198" y="152" width="126" height="48" rx="10" class="bd-tier bd-tier--top"/>
		<path d="M198 168 q10 14 21 0 t21 0 t21 0 t21 0 t21 0 t21 0" class="bd-icing"/>
		<path d="M166 214 q12.5 14 23.75 0 t23.75 0 t23.75 0 t23.75 0 t23.75 0 t23.75 0 t23.75 0 t23.75 0" class="bd-icing"/>
		<text x="261" y="248" class="bd-age">${age}</text>
		<g class="bd-candles">
			<g class="bd-candle" style="--i:0"><rect x="222" y="124" width="7" height="30" rx="2" class="bd-wax"/><path d="M225.5 108 q-7 9 0 15 q7 -6 0 -15z" class="bd-flame"/></g>
			<g class="bd-candle" style="--i:1"><rect x="258" y="124" width="7" height="30" rx="2" class="bd-wax"/><path d="M261.5 108 q-7 9 0 15 q7 -6 0 -15z" class="bd-flame"/></g>
			<g class="bd-candle" style="--i:2"><rect x="294" y="124" width="7" height="30" rx="2" class="bd-wax"/><path d="M297.5 108 q-7 9 0 15 q7 -6 0 -15z" class="bd-flame"/></g>
		</g>
	</g>
</svg>`;

// Builds the scene inside `host` (a fixed overlay div). Returns nothing; egg.js removes the host.
export function mountScene(host, age, reduced) {
	host.innerHTML = svg(age);
	if (reduced) { host.classList.add('is-still'); return; }
	const colors = ['var(--egg-rose)', 'var(--points)', 'var(--accent)', '#f59e0b', '#10b981'];
	const conf = document.createElement('div');
	conf.className = 'bd-confetti';
	for (let i = 0; i < 56; i++) {
		const p = document.createElement('i');
		p.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}vw;--d:${(2.6 + Math.random() * 2.4).toFixed(2)}s;--w:${(Math.random() * 1.4).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${colors[i % colors.length]}`;
		conf.append(p);
	}
	host.append(conf);
}
