import * as assert from 'assert';
import * as vscode from 'vscode';

import {
	gatherSemanticFacts,
	foldSemanticsIntoContext,
	LOW_CONFIDENCE_MARKER,
	type CommandExecutor,
} from '../structure/semantics';
import { buildDeepDivePrompt } from '../analysis/prompts';

const SRC_URI = vscode.Uri.file('/proj/src/main.ts');
const DEF_URI = vscode.Uri.file('/proj/src/helper.ts');
const POSITION = new vscode.Position(2, 10);
const DEF_RANGE = new vscode.Range(new vscode.Position(4, 0), new vscode.Position(4, 0));
const DEF_TEXT = 'export function helper(n: number): number';

/** Build an executor whose hover/definition results are supplied per test. */
function mockExecutor(
	hoverResult: unknown,
	definitionResult: unknown,
): CommandExecutor {
	return <T>(command: string): Thenable<T> => {
		let result: unknown;
		if (command === 'vscode.executeHoverProvider') {
			result = hoverResult;
		} else if (command === 'vscode.executeDefinitionProvider') {
			result = definitionResult;
		}
		return Promise.resolve(result as T);
	};
}

suite('structure/semantics Test Suite', () => {
	test('resolved definitions are folded into the deep-dive context', async () => {
		const hover = new vscode.Hover(new vscode.MarkdownString('const result: number'));
		const location = new vscode.Location(DEF_URI, DEF_RANGE);

		const facts = await gatherSemanticFacts(SRC_URI, POSITION, {
			exec: mockExecutor([hover], [location]),
			readDefinition: () => Promise.resolve(DEF_TEXT),
		});

		assert.strictEqual(facts.lowConfidence, false);
		assert.strictEqual(facts.definitions.length, 1);
		assert.strictEqual(facts.definitions[0].text, DEF_TEXT);

		const { context, lowConfidence } = foldSemanticsIntoContext(facts, 'base context');
		assert.strictEqual(lowConfidence, false);
		assert.ok(context.includes('base context'));
		assert.ok(context.includes('Resolved definitions:'), 'definitions section present');
		assert.ok(context.includes(DEF_TEXT), 'definition text folded in');
		assert.ok(context.includes('const result: number'), 'hover type folded in');
		assert.ok(context.includes('helper.ts:5'), 'Defined-at location present');

		// And it actually reaches the deep-dive prompt.
		const prompt = buildDeepDivePrompt({ code: 'helper(x)', languageId: 'typescript', context });
		assert.ok(prompt.includes(DEF_TEXT), 'definition text reaches the deep-dive prompt');
	});

	test('LocationLink results are normalized and folded in', async () => {
		const link: vscode.LocationLink = {
			targetUri: DEF_URI,
			targetRange: DEF_RANGE,
			targetSelectionRange: DEF_RANGE,
		};

		const facts = await gatherSemanticFacts(SRC_URI, POSITION, {
			exec: mockExecutor([], [link]),
			readDefinition: () => Promise.resolve(DEF_TEXT),
		});

		assert.strictEqual(facts.definitions.length, 1);
		assert.strictEqual(facts.lowConfidence, false);
		assert.ok(foldSemanticsIntoContext(facts).context.includes(DEF_TEXT));
	});

	test('low-confidence flag is set when results are empty', async () => {
		const facts = await gatherSemanticFacts(SRC_URI, POSITION, {
			exec: mockExecutor([], []),
			readDefinition: () => Promise.resolve(''),
		});

		assert.strictEqual(facts.lowConfidence, true);
		assert.strictEqual(facts.hoverTexts.length, 0);
		assert.strictEqual(facts.definitions.length, 0);

		const { context, lowConfidence } = foldSemanticsIntoContext(facts);
		assert.strictEqual(lowConfidence, true);
		assert.ok(context.includes(LOW_CONFIDENCE_MARKER), 'low-confidence marker present');
	});

	test('undefined provider results also yield low confidence', async () => {
		const facts = await gatherSemanticFacts(SRC_URI, POSITION, {
			exec: mockExecutor(undefined, undefined),
		});

		assert.strictEqual(facts.lowConfidence, true);
	});
});
