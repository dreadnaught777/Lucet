import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
	selectNode,
	createParser,
	grammarWasmPath,
	isStatementType,
} from '../structure/parser';
import Parser = require('web-tree-sitter');

// The extension install dir is the repo root; from out/test that is two up.
const EXTENSION_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(EXTENSION_DIR, 'src', 'test', 'fixtures');

function readFixture(name: string): string {
	return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

suite('structure/parser Test Suite', () => {
	let parser: Parser;
	const tsSource = readFixture('sample-ts.txt');

	suiteSetup(async function () {
		this.timeout(20000);
		parser = await createParser(EXTENSION_DIR, 'typescript');
	});

	test('grammarWasmPath resolves from the extension dir, not the workspace', () => {
		const p = grammarWasmPath('/install/here', 'typescript');
		assert.strictEqual(
			p.split(path.sep).join('/'),
			'/install/here/grammars/tree-sitter-typescript.wasm',
		);
		assert.ok(p.startsWith('/install/here'.split('/').join(path.sep)));
	});

	test('cursor inside a call returns the enclosing call-expression range', () => {
		const tree = parser.parse(tsSource)!;
		// Offset of `alpha` inside `compute(alpha, beta)`.
		const callStart = tsSource.indexOf('compute(alpha');
		const offset = tsSource.indexOf('alpha', callStart);

		const selected = selectNode(tree.rootNode, offset);

		assert.ok(selected, 'expected a selection');
		assert.strictEqual(selected!.type, 'call_expression');
		const callExpr = 'compute(alpha, beta)';
		assert.strictEqual(selected!.startIndex, tsSource.indexOf(callExpr));
		assert.strictEqual(
			selected!.endIndex,
			tsSource.indexOf(callExpr) + callExpr.length,
		);
	});

	test('cursor outside any call returns the enclosing statement range', () => {
		const tree = parser.parse(tsSource)!;
		// Offset of `alpha` inside `const sum = alpha + beta;` (not a call).
		const stmtText = 'const sum = alpha + beta;';
		const stmtStart = tsSource.indexOf(stmtText);
		const offset = tsSource.indexOf('alpha', stmtStart);

		const selected = selectNode(tree.rootNode, offset);

		assert.ok(selected, 'expected a selection');
		assert.ok(
			isStatementType(selected!.type),
			`expected a statement type, got ${selected!.type}`,
		);
		assert.strictEqual(selected!.startIndex, stmtStart);
		assert.strictEqual(selected!.endIndex, stmtStart + stmtText.length);
	});
});
