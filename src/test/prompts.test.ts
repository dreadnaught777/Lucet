import * as assert from 'assert';

import {
	buildDeepDivePrompt,
	DEEP_DIVE_SECTIONS,
	promptVersion,
} from '../analysis/prompts';

suite('analysis/prompts Test Suite', () => {
	test('there are exactly five fixed deep-dive sections', () => {
		assert.deepStrictEqual(
			[...DEEP_DIVE_SECTIONS],
			['What it does', 'Inputs and outputs', 'Side effects', 'Edge cases', 'Defined at'],
		);
	});

	test('deep-dive prompt emits all five section headers in order', () => {
		const prompt = buildDeepDivePrompt({
			code: 'function add(a: number, b: number) { return a + b; }',
			languageId: 'typescript',
		});

		const headers = ['What it does', 'Inputs and outputs', 'Side effects', 'Edge cases', 'Defined at'];

		let searchFrom = 0;
		for (const header of headers) {
			const marker = `## ${header}`;
			const at = prompt.indexOf(marker, searchFrom);
			assert.ok(at !== -1, `missing header: ${marker}`);
			searchFrom = at + marker.length;
		}
	});

	test('deep-dive prompt includes the target code and language', () => {
		const prompt = buildDeepDivePrompt({
			code: 'const x = 1;',
			languageId: 'typescript',
		});

		assert.ok(prompt.includes('const x = 1;'));
		assert.ok(prompt.includes('typescript'));
	});

	test('promptVersion is a positive integer (part of every cache key)', () => {
		assert.ok(Number.isInteger(promptVersion) && promptVersion > 0);
	});
});
