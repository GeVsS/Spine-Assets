// NEON BREACH portfolio demo: an in-browser stand-in for Stake's RGS, ported from the game's mock_rgs.mjs.
// It answers the game's https://mock/... calls in the page and plays the sample rounds bundled in books/*.json
// (the Storybook sample books). No real math, no server, no money.
// Launch params are optional: a plain link gets sessionID=demo&rgs_url=mock&lang=en&currency=USD.
// Switches kept from the mock: mock_balance=5 (start balance), mock_book=<id> (always that round, 0 = a loss).
(() => {
	const p = new URLSearchParams(location.search);
	if (!p.get('rgs_url')) {
		for (const [k, v] of Object.entries({ sessionID: 'demo', rgs_url: 'mock', lang: 'en', currency: 'USD' })) if (!p.has(k)) p.set(k, v);
		history.replaceState(history.state, '', `${location.pathname}?${p}${location.hash}`);
	}
	const q = (k) => new URLSearchParams(location.search).get(k);
	const FILES = { BASE: 'base', DATA_BOOST: 'data_boost', BREACH_BONUS: 'breach_bonus', SUPER_BREACH: 'super_breach' };
	const COST = { BASE: 1, DATA_BOOST: 1.25, BREACH_BONUS: 100, SUPER_BREACH: 300 };
	const ZERO_DECIMALS = ['JPY', 'KRW', 'IDR', 'VND', 'CLP', 'ISK', 'UGX', 'XOF'];
	const realFetch = window.fetch.bind(window);
	const books = {};
	const load = (mode) => (books[mode] ??= realFetch(new URL(`books/${FILES[mode]}.json`, document.baseURI)).then((r) => r.json()));
	const sessions = {};
	const levelsFor = (currency) => {
		const scale = ZERO_DECIMALS.includes(currency) ? 100 : 1;
		return [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].map((v) => Math.round(v * scale * 1e6));
	};

	async function rgs(route, body) {
		const currency = (q('currency') || 'USD').toUpperCase();
		const levels = levelsFor(currency);
		const s = (sessions[body?.sessionID] ??= { balance: Number(q('mock_balance') ?? 1000) * 1e6, round: null });
		const balance = () => ({ amount: s.balance, currency });
		const err = (error, message) => [400, { error, message }];
		if (route === '/wallet/authenticate')
			return [200, {
				balance: balance(),
				config: {
					minBet: levels[0], maxBet: levels.at(-1), stepBet: levels[0], defaultBetLevel: levels[6], betLevels: levels,
					gameModes: Object.keys(COST).map((mode) => ({ mode, costMultiplier: COST[mode], maxBet: levels.at(-1) })),
					jurisdiction: { socialCasino: q('social') === 'true', minimumRoundDuration: 0 },
				},
				...(s.round?.active ? { round: s.round } : {}),
			}];
		if (route === '/wallet/balance') return [200, { balance: balance() }];
		if (route === '/wallet/play') {
			const mode = String(body.mode).toUpperCase();
			if (!FILES[mode]) return err('ERR_VAL', 'unknown mode');
			if (s.round?.active) return err('ERR_VAL', 'round already active');
			if (!levels.includes(body.amount)) return err('ERR_VAL', 'invalid amount');
			if (body.amount * COST[mode] > s.balance) return err('ERR_IPB', 'insufficient balance');
			const all = await load(mode);
			const pick = q('mock_book');
			const pool = pick === '0' ? all.filter((b) => !b.payoutMultiplier) : pick ? all.filter((b) => String(b.id) === pick) : all;
			const book = (pool.length ? pool : all)[Math.floor(Math.random() * (pool.length || all.length))];
			const payout = Math.round(body.amount * book.payoutMultiplier);
			s.balance -= body.amount * COST[mode];
			s.round = { betID: book.id, amount: body.amount, payout, payoutMultiplier: book.payoutMultiplier,
				active: payout > 0, mode, event: null, state: book.events };
			return [200, { balance: balance(), round: s.round }];
		}
		if (route === '/wallet/end-round') {
			if (!s.round?.active) return err('ERR_VAL', 'no active round');
			s.balance += s.round.payout;
			s.round.active = false;
			return [200, { balance: balance() }];
		}
		if (route === '/bet/event') {
			if (s.round?.active) s.round.event = body.event;
			return [200, { event: body.event }];
		}
		const replay = route.match(/^\/bet\/replay\/[^/]+\/[^/]+\/([^/]+)\/(\d+)$/);
		if (replay) {
			const mode = replay[1].toUpperCase();
			const book = FILES[mode] && (await load(mode)).find((b) => String(b.id) === replay[2]);
			if (!book) return [404, null];
			return [200, { payoutMultiplier: book.payoutMultiplier, costMultiplier: COST[mode], state: book.events }];
		}
		return [404, { error: 'ERR_NF', message: route }];
	}

	window.fetch = async (u, o) => {
		const url = typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;
		if (!url.startsWith('https://mock/')) return realFetch(u, o);
		const [status, data] = await rgs(new URL(url).pathname, o?.body ? JSON.parse(o.body) : null);
		return data === null
			? new Response(null, { status })
			: new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
	};
})();
