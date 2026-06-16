// Step-1 verification harness: run one live glance-style query() through the
// project's session wrapper and report model, cost, and auth source.
// Run: node scripts/verify-auth.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const session = require('../out/analysis/session.js');

if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
	console.error('REFUSE: ANTHROPIC_API_KEY/AUTH_TOKEN is set; unset it so subscription OAuth wins.');
	process.exit(2);
}

const prompt = 'Explain in one sentence: `const x = 1;`';
const model = process.argv[2]; // optional model id

const run = async () => {
	const q = await session.startAnalysisSession(prompt, model ? { model } : {});
	console.log('requested model:', model ?? '(default)');
	let text = '';
	let result = null;
	for await (const message of q) {
		if (message.type === 'assistant') {
			for (const block of message.message?.content ?? []) {
				if (block.type === 'text') text += block.text;
			}
		} else if (message.type === 'result') {
			result = message;
		} else if (message.type === 'system' && message.subtype === 'init') {
			console.log('INIT model:', message.model, '| apiKeySource:', message.apiKeySource);
		}
	}
	console.log('---- RESPONSE ----');
	console.log(text.trim());
	console.log('---- RESULT ----');
	if (result) {
		console.log('subtype:', result.subtype);
		console.log('total_cost_usd:', result.total_cost_usd);
		console.log('model (usage keys):', Object.keys(result.modelUsage ?? {}).join(', '));
	} else {
		console.log('no result message');
	}
};

run().then(() => process.exit(0)).catch((e) => {
	console.error('QUERY FAILED:', e?.message ?? e);
	process.exit(1);
});
