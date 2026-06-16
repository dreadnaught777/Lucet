// Sanity: the warm session prewarms without hanging and reuses across asks.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const session = require('../out/analysis/session.js');
const prompts = require('../out/analysis/prompts.js');

const now = () => Number(process.hrtime.bigint() / 1000000n);
const p = (code) => prompts.buildGlancePrompt({ code, languageId: 'typescript' });

const run = async () => {
	const warm = session.createWarmSession({ model: 'claude-haiku-4-5-20251001' });
	const t0 = now();
	await warm.prewarm();
	console.log('prewarm returned in', now() - t0, 'ms (must not hang)');

	const a = now();
	const r1 = await warm.ask(p('const x = 1;'));
	const firstMs = now() - a;
	const b = now();
	const r2 = await warm.ask(p('arr.map(n => n + 1)'));
	const secondMs = now() - b;
	warm.dispose();

	console.log('ask#1', firstMs, 'ms, text?', r1.text.length > 0);
	console.log('ask#2 (reused, no spawn)', secondMs, 'ms, text?', r2.text.length > 0);
};

run().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e?.message ?? e); process.exit(1); });
