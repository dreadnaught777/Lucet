// Headless verification of the deep-dive, as-Python, and (bounded) why tiers.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const session = require('../out/analysis/session.js');
const prompts = require('../out/analysis/prompts.js');
const collect = require('../out/analysis/collect.js');

const TS_FN = 'function doubleEvens(xs) {\n  return xs.filter(n => n % 2 === 0).map(n => n * 2);\n}';

const drain = async (stream) => collect.collectResult(stream);

const run = async () => {
	// Deep dive (Opus): expect the five section headers.
	const dd = await drain(
		await session.startAnalysisSession(
			prompts.buildDeepDivePrompt({ code: TS_FN, languageId: 'typescript' }),
			{ model: 'claude-opus-4-8' },
		),
	);
	const headers = ['What it does', 'Inputs and outputs', 'Side effects', 'Edge cases', 'Defined at'];
	const present = headers.filter((h) => dd.text.includes('## ' + h));
	console.log('DEEP-DIVE headers present:', present.length, '/ 5', '| cost', dd.costUSD.toFixed(4));

	// As Python (Sonnet): expect a comprehension, not a for-loop.
	const py = await drain(
		await session.startAnalysisSession(
			prompts.buildAsPythonPrompt({ code: TS_FN, languageId: 'typescript' }, 'python'),
			{ model: 'claude-sonnet-4-6' },
		),
	);
	console.log('AS-PYTHON has comprehension:', /\bfor\b.*\bin\b.*\]/.test(py.text) || /\[.*for .* in /.test(py.text), '| cost', py.costUSD.toFixed(4));

	// Why (bounded): confirm the tool-enabled session runs and returns.
	const why = await drain(
		await session.startWhySession(
			prompts.buildWhyPrompt({ code: TS_FN, languageId: 'typescript', context: 'Project dependencies: lodash@^4.17.21' }),
			{ model: 'claude-opus-4-8', maxTurns: 2 },
		),
	);
	console.log('WHY returned text:', why.text.length > 0, '| cost', why.costUSD.toFixed(4));
};

run().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e?.message ?? e); process.exit(1); });
