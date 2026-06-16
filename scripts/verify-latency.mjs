// Compare cold-start-per-call vs a warm reused session for glance-sized prompts.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const session = require('../out/analysis/session.js');
const prompts = require('../out/analysis/prompts.js');
const collect = require('../out/analysis/collect.js');

const GLANCE_MODEL = 'claude-haiku-4-5-20251001';
const snippets = ['const x = 1;', 'arr.map(n => n * 2)', 'await fetch(url)'];
const now = () => Number(process.hrtime.bigint() / 1000000n);

const buildPrompt = (code) => prompts.buildGlancePrompt({ code, languageId: 'typescript' });

const run = async () => {
	// COLD: a fresh query() per call (the old per-hover behaviour).
	const coldTimes = [];
	for (const code of snippets) {
		const t0 = now();
		const stream = await session.startAnalysisSession(buildPrompt(code), { model: GLANCE_MODEL });
		await collect.collectResult(stream);
		coldTimes.push(now() - t0);
	}

	// WARM: one reused, pre-warmed session, one ask() per call.
	const warm = session.createWarmSession({ model: GLANCE_MODEL });
	const tw = now();
	await warm.prewarm();
	console.log('PREWARM ms:', now() - tw);
	const warmTimes = [];
	for (const code of snippets) {
		const t0 = now();
		const r = await warm.ask(buildPrompt(code));
		warmTimes.push({ ms: now() - t0, ok: r.text.length > 0 });
	}
	warm.dispose();

	const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
	console.log('COLD ms per call:', coldTimes.map((m) => Math.round(m)).join(', '), '| avg', avg(coldTimes));
	console.log('WARM ms per call:', warmTimes.map((w) => w.ms).join(', '), '| avg', avg(warmTimes.map((w) => w.ms)));
	console.log('WARM all returned text:', warmTimes.every((w) => w.ok));
	console.log('WARM under 1500ms after first:', warmTimes.slice(1).every((w) => w.ms < 1500));
};

run().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e?.message ?? e); process.exit(1); });
