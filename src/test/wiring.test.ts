import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { collectResult } from '../analysis/collect';
import { CostMeter } from '../ui/meter';
import { assembleGlanceContext, collectImportLines } from '../context/assembler';
import { splitMarkdownSections, escapeHtml } from '../ui/panel';
import { computeWhyCacheKey } from '../cache/store';
import { selectEnclosingFunction, createParser } from '../structure/parser';
import type Parser = require('web-tree-sitter');

const EXTENSION_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(EXTENSION_DIR, 'src', 'test', 'fixtures');

async function* fakeStream() {
	yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello ' }] } };
	yield { type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } };
	yield { type: 'result', subtype: 'success', total_cost_usd: 0.02 };
}

suite('integration wiring Test Suite', () => {
	test('collectResult accumulates text and feeds the cost meter', async () => {
		const meter = new CostMeter(() => new Date(2026, 5, 16));
		const result = await collectResult(fakeStream(), meter);
		assert.strictEqual(result.text, 'Hello world');
		assert.ok(Math.abs(result.costUSD - 0.02) < 1e-9);
		assert.ok(Math.abs(meter.monthToDateUSD - 0.02) < 1e-9, 'meter received the cost');
	});

	test('assembleGlanceContext returns node text and surfaces imports', () => {
		const source = "import { foo } from './foo';\nconst x = foo(1);\n";
		const start = source.indexOf('foo(1)');
		const end = start + 'foo(1)'.length;
		const ctx = assembleGlanceContext(source, start, end);
		assert.strictEqual(ctx.targetText, 'foo(1)');
		assert.ok(ctx.context.includes("import { foo } from './foo';"));
		assert.deepStrictEqual(collectImportLines(source), ["import { foo } from './foo';"]);
	});

	test('escapeHtml covers all five HTML-spec characters', () => {
		// & is escaped first so the introduced &amp; entities are not re-escaped.
		assert.strictEqual(escapeHtml('&'), '&amp;');
		assert.strictEqual(escapeHtml('<'), '&lt;');
		assert.strictEqual(escapeHtml('>'), '&gt;');
		assert.strictEqual(escapeHtml('"'), '&quot;');
		assert.strictEqual(escapeHtml("'"), '&#39;');
		// Combined: a payload that would break out of an attribute if quotes
		// were unescaped is rendered fully inert.
		assert.strictEqual(
			escapeHtml('"><script>alert(1)</script>'),
			'&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
		);
		// Idempotence-of-ampersand sanity check: do not double-escape entities.
		assert.strictEqual(escapeHtml('&amp;'), '&amp;amp;');
	});

	test('splitMarkdownSections parses the five deep-dive headers', () => {
		const md = '## What it does\nDoes a thing.\n## Inputs and outputs\nIn, out.\n## Side effects\nNone.';
		const sections = splitMarkdownSections(md);
		assert.deepStrictEqual(
			sections.map((s) => s.header),
			['What it does', 'Inputs and outputs', 'Side effects'],
		);
		assert.strictEqual(sections[0].body, 'Does a thing.');
	});

	test('why cache key includes the dependency-manifest hash', () => {
		const base = { targetText: 'x', dependencyManifestHash: 'abc', promptVersion: 1 };
		assert.strictEqual(computeWhyCacheKey(base), computeWhyCacheKey({ ...base }));
		assert.notStrictEqual(
			computeWhyCacheKey(base),
			computeWhyCacheKey({ ...base, dependencyManifestHash: 'def' }),
		);
	});

	suite('enclosing-function selection', () => {
		let parser: Parser;
		const source = fs.readFileSync(path.join(FIXTURE_DIR, 'sample-fn-ts.txt'), 'utf8');

		suiteSetup(async function () {
			this.timeout(20000);
			parser = await createParser(EXTENSION_DIR, 'typescript');
		});

		test('a cursor inside a function body selects the whole function', () => {
			const tree = parser.parse(source)!;
			const offset = source.indexOf('compute(a, b)');
			const unit = selectEnclosingFunction(tree.rootNode, offset);
			assert.ok(unit, 'expected a unit');
			assert.strictEqual(unit!.type, 'function_declaration');
			assert.strictEqual(unit!.startIndex, source.indexOf('function add'));
		});
	});
});
