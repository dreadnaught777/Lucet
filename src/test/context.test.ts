import * as assert from 'assert';

import { buildSurroundingContext } from '../analysis/context';

suite('analysis/context Test Suite', () => {
	const lines = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'];

	test('returns a symmetric window around the target', () => {
		const ctx = buildSurroundingContext(lines, 5, 2);

		assert.strictEqual(ctx.startLine, 3);
		assert.strictEqual(ctx.endLine, 7);
		assert.strictEqual(ctx.targetLine, 5);
		assert.strictEqual(ctx.text, 'l3\nl4\nl5\nl6\nl7');
	});

	test('clamps the window at the top of the file', () => {
		const ctx = buildSurroundingContext(lines, 1, 5);

		assert.strictEqual(ctx.startLine, 0);
		assert.strictEqual(ctx.endLine, 6);
		assert.strictEqual(ctx.text.split('\n')[0], 'l0');
	});

	test('clamps the window at the bottom of the file', () => {
		const ctx = buildSurroundingContext(lines, 9, 3);

		assert.strictEqual(ctx.startLine, 6);
		assert.strictEqual(ctx.endLine, 9);
		assert.strictEqual(ctx.text, 'l6\nl7\nl8\nl9');
	});

	test('clamps an out-of-range target line', () => {
		const ctx = buildSurroundingContext(lines, 999, 1);

		assert.strictEqual(ctx.targetLine, 9);
		assert.strictEqual(ctx.endLine, 9);
	});

	test('handles an empty document', () => {
		const ctx = buildSurroundingContext([], 3, 4);

		assert.deepStrictEqual(ctx, { text: '', startLine: 0, endLine: 0, targetLine: 0 });
	});

	test('radius 0 returns only the target line', () => {
		const ctx = buildSurroundingContext(lines, 4, 0);

		assert.strictEqual(ctx.text, 'l4');
		assert.strictEqual(ctx.startLine, 4);
		assert.strictEqual(ctx.endLine, 4);
	});
});
