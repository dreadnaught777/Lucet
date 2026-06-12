import * as assert from 'assert';

import {
	shouldShowAsPython,
	buildAsPythonPrompt,
	DEFAULT_PIVOT_LANGUAGE,
} from '../analysis/prompts';
import { computePythonViewCacheKey } from '../cache/store';

suite('As Python view Test Suite', () => {
	test('affordance is hidden when the source language equals the pivot language', () => {
		assert.strictEqual(shouldShowAsPython('python', 'python'), false);
		assert.strictEqual(shouldShowAsPython('Python', 'python'), false, 'case-insensitive');
		assert.strictEqual(shouldShowAsPython('python'), false, 'default pivot is python');
		assert.strictEqual(DEFAULT_PIVOT_LANGUAGE, 'python');
	});

	test('affordance is shown when the source language differs from the pivot', () => {
		assert.strictEqual(shouldShowAsPython('typescript', 'python'), true);
		assert.strictEqual(shouldShowAsPython('typescript'), true);
		assert.strictEqual(shouldShowAsPython('go', 'rust'), true);
	});

	test('python-view prompt builder renders the source unit toward the pivot', () => {
		const prompt = buildAsPythonPrompt({
			code: 'const xs = [1,2,3].map(n => n * 2);',
			languageId: 'typescript',
		});
		assert.ok(prompt.includes('const xs = [1,2,3].map(n => n * 2);'), 'source code present');
		assert.ok(prompt.toLowerCase().includes('idiomatic'), 'asks for idiomatic output');
		assert.ok(/illustrative|not a port|not.*runnable/i.test(prompt), 'illustrative caveat');
		assert.ok(prompt.includes('python'), 'targets python');
	});

	test('cache key includes pivotLanguage', () => {
		const base = { targetText: 'fn foo() {}', pivotLanguage: 'python', promptVersion: 1 };

		// Deterministic for identical inputs.
		assert.strictEqual(
			computePythonViewCacheKey(base),
			computePythonViewCacheKey({ ...base }),
		);

		// Changing only the pivot language changes the key.
		assert.notStrictEqual(
			computePythonViewCacheKey(base),
			computePythonViewCacheKey({ ...base, pivotLanguage: 'ruby' }),
		);
	});
});
