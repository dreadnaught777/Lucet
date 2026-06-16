// Structure layer: web-tree-sitter node selection and grammar loading.
//
// Turns a cursor offset into the unit to explain. The grammar `.wasm` files are
// resolved relative to the extension install directory, never the workspace, so
// the parser works the same regardless of what project is open.
import * as path from 'path';
import Parser = require('web-tree-sitter');

type SyntaxNode = Parser.SyntaxNode;

/** Tree-sitter node types that represent a call across our supported grammars. */
export const CALL_NODE_TYPES = ['call_expression', 'call'];

/**
 * Absolute path to a grammar `.wasm` file, resolved from the extension install
 * directory. Never resolve grammars from the workspace — a project must not be
 * able to swap the parser out from under us.
 */
export function grammarWasmPath(extensionDir: string, language: string): string {
	return path.join(extensionDir, 'grammars', `tree-sitter-${language}.wasm`);
}

/**
 * True for node types that delimit a complete statement / declaration. Used as
 * the stop boundary when searching for an enclosing call and as the fallback
 * unit when the cursor is not inside a call.
 */
export function isStatementType(type: string): boolean {
	return (
		type.endsWith('_statement') ||
		type.endsWith('_declaration') ||
		type.endsWith('_definition')
	);
}

/** A selected unit: its node type and character range in the document. */
export interface SelectedNode {
	type: string;
	startIndex: number;
	endIndex: number;
}

function toSelected(node: SyntaxNode): SelectedNode {
	return { type: node.type, startIndex: node.startIndex, endIndex: node.endIndex };
}

/**
 * Select the unit to explain for a cursor at character `offset`.
 *
 * - If the cursor is inside a call expression, return the nearest enclosing call
 *   expression (highlight the whole call, not the raw line).
 * - Otherwise, return the enclosing statement, falling back to the smallest
 *   named node when no statement encloses the cursor.
 */
export function selectNode(root: SyntaxNode, offset: number): SelectedNode | null {
	const leaf = root.namedDescendantForIndex(offset);
	if (!leaf) {
		return null;
	}

	// Prefer the nearest enclosing call, but do not escape the current statement.
	for (let n: SyntaxNode | null = leaf; n; n = n.parent) {
		if (CALL_NODE_TYPES.includes(n.type)) {
			return toSelected(n);
		}
		if (isStatementType(n.type)) {
			break;
		}
	}

	// Otherwise fall back to the enclosing statement.
	for (let n: SyntaxNode | null = leaf; n; n = n.parent) {
		if (isStatementType(n.type)) {
			return toSelected(n);
		}
	}

	return toSelected(leaf);
}

/** Node types that delimit an enclosing function or class for the deep-dive unit. */
export const FUNCTION_NODE_TYPES = [
	'function_declaration',
	'function_definition',
	'function_expression',
	'generator_function_declaration',
	'method_definition',
	'arrow_function',
	'class_declaration',
	'class_definition',
];

/**
 * Select the enclosing function or class for a cursor at `offset` (the deep-dive
 * unit). Falls back to {@link selectNode} when the cursor is not inside one.
 */
export function selectEnclosingFunction(root: SyntaxNode, offset: number): SelectedNode | null {
	const leaf = root.namedDescendantForIndex(offset);
	if (!leaf) {
		return null;
	}
	for (let n: SyntaxNode | null = leaf; n; n = n.parent) {
		if (FUNCTION_NODE_TYPES.includes(n.type)) {
			return toSelected(n);
		}
	}
	return selectNode(root, offset);
}

let initPromise: Promise<void> | undefined;

/** Initialise the tree-sitter runtime once per extension host. */
export function initParser(): Promise<void> {
	if (!initPromise) {
		initPromise = Parser.init();
	}
	return initPromise;
}

/** Load a grammar from the extension dir and return a configured parser. */
export async function createParser(
	extensionDir: string,
	language: string,
): Promise<Parser> {
	await initParser();
	const grammar = await Parser.Language.load(grammarWasmPath(extensionDir, language));
	const parser = new Parser();
	parser.setLanguage(grammar);
	return parser;
}
