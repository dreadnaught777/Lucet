// Lazy per-grammar parser registry. Maps VS Code language ids to the bundled
// tree-sitter grammar and caches one parser per grammar for the host's lifetime.
import Parser = require('web-tree-sitter');
import { createParser } from './parser';

/** VS Code languageId → grammar wasm basename (resolved from the extension dir). */
const GRAMMAR_FOR_LANGUAGE: Record<string, string> = {
	typescript: 'typescript',
	javascript: 'javascript',
	javascriptreact: 'javascript',
	typescriptreact: 'tsx',
	python: 'python',
};

const parsers = new Map<string, Promise<Parser>>();

/** True if Lucet has a grammar for this language id. */
export function isSupportedLanguage(languageId: string): boolean {
	return languageId in GRAMMAR_FOR_LANGUAGE;
}

/**
 * Return a configured parser for `languageId`, or undefined if unsupported.
 * Parsers are created once per grammar and reused.
 */
export function getParserFor(
	extensionDir: string,
	languageId: string,
): Promise<Parser> | undefined {
	const grammar = GRAMMAR_FOR_LANGUAGE[languageId];
	if (!grammar) {
		return undefined;
	}
	let parser = parsers.get(grammar);
	if (!parser) {
		parser = createParser(extensionDir, grammar);
		parsers.set(grammar, parser);
	}
	return parser;
}
