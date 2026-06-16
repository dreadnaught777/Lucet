import * as assert from 'assert';

import {
	buildFitSection,
	buildWhyPrompt,
	hasReferent,
	UnreferencedFitClaimError,
	WHY_SECTIONS,
} from '../analysis/prompts';
import {
	analysisSessionOptions,
	whySessionOptions,
	WHY_TOOLS,
} from '../analysis/session';

suite('why tier — prompt builder Test Suite', () => {
	test('rejects a fit claim with no referent', () => {
		assert.throws(
			() => buildFitSection([{ claim: 'A plain object is the right choice here' }]),
			UnreferencedFitClaimError,
		);
		assert.throws(
			() => buildFitSection([{ claim: 'fits', referent: '   ' }]),
			UnreferencedFitClaimError,
			'whitespace-only referent is still no referent',
		);
		assert.strictEqual(hasReferent({ claim: 'x' }), false);
	});

	test('accepts a fit claim that cites a project fact', () => {
		const section = buildFitSection([
			{
				claim: 'Use lodash.groupBy rather than hand-rolling',
				referent: { kind: 'dependency', detail: 'lodash@^4.17.21 in package.json' },
			},
		]);
		assert.ok(section.includes('lodash@^4.17.21'));
		assert.ok(section.includes('## Fit here'));
	});

	test('why prompt names the sections and the no-referent rule', () => {
		const prompt = buildWhyPrompt({ code: 'const x = 1;', languageId: 'typescript' });
		for (const section of WHY_SECTIONS) {
			assert.ok(prompt.includes(`## ${section}`), `missing section: ${section}`);
		}
		assert.ok(/referent|checkable project fact/i.test(prompt));
	});
});

suite('why tier — session tool tiers Test Suite', () => {
	const env = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'secret' };

	test('why session is limited to Read, Grep, Glob, Bash', () => {
		const opts = whySessionOptions(env);
		assert.deepStrictEqual([...opts.allowedTools].sort(), ['Bash', 'Glob', 'Grep', 'Read']);
		assert.deepStrictEqual([...WHY_TOOLS], ['Read', 'Grep', 'Glob', 'Bash']);
		// Credentials are still stripped on the why tier.
		assert.strictEqual(opts.env.ANTHROPIC_API_KEY, undefined);
	});

	test('glance and deep-dive still run allowedTools: []', () => {
		const opts = analysisSessionOptions(env);
		assert.deepStrictEqual(opts.allowedTools, []);
		assert.strictEqual(opts.env.ANTHROPIC_API_KEY, undefined);
	});
});
