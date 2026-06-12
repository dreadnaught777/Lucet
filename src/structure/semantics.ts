// Semantic grounding: thin wrappers over VS Code's own hover/definition
// providers. We reuse whatever language servers the user already has installed
// rather than building an LSP client, and fold the resolved facts into the
// deep-dive context so the model works from real types, not inference.
import * as vscode from 'vscode';

/**
 * Injectable command runner. Defaults to `vscode.commands.executeCommand`; tests
 * pass a fake so provider results can be mocked without a live language server.
 */
export type CommandExecutor = <T>(command: string, ...rest: unknown[]) => Thenable<T>;

/** Injectable reader for a definition's source text. */
export type DefinitionReader = (
	uri: vscode.Uri,
	range: vscode.Range,
) => Thenable<string>;

export interface ResolvedDefinition {
	uri: vscode.Uri;
	range: vscode.Range;
	text: string;
}

export interface SemanticFacts {
	/** Plain-text fragments extracted from hover results (types, signatures). */
	hoverTexts: string[];
	/** Definitions resolved at the cursor, with their source text. */
	definitions: ResolvedDefinition[];
	/** True when no semantic data resolved — the deep dive must say so. */
	lowConfidence: boolean;
}

export interface SemanticDeps {
	exec?: CommandExecutor;
	readDefinition?: DefinitionReader;
}

/** Rendered into the context (and surfaced in the UI) when grounding failed. */
export const LOW_CONFIDENCE_MARKER =
	'> Low confidence: no semantic data was available for this unit; the explanation relies on the code alone.';

const defaultExec: CommandExecutor = (command, ...rest) =>
	vscode.commands.executeCommand(command, ...rest);

const defaultReadDefinition: DefinitionReader = async (uri, range) => {
	const doc = await vscode.workspace.openTextDocument(uri);
	// A bare definition position widens to its whole line so the signature shows.
	const target = range.isEmpty ? doc.lineAt(range.start.line).range : range;
	return doc.getText(target);
};

function contentToText(content: vscode.MarkdownString | vscode.MarkedString): string {
	if (typeof content === 'string') {
		return content;
	}
	return (content as { value?: string }).value ?? '';
}

/** Extract non-empty plain-text fragments from hover results. */
export function extractHoverTexts(hovers: readonly vscode.Hover[]): string[] {
	const texts: string[] = [];
	for (const hover of hovers) {
		for (const content of hover.contents) {
			const text = contentToText(content).trim();
			if (text) {
				texts.push(text);
			}
		}
	}
	return texts;
}

type DefinitionResult =
	| vscode.Location
	| vscode.LocationLink
	| Array<vscode.Location | vscode.LocationLink>
	| null
	| undefined;

/** Normalise the several shapes `executeDefinitionProvider` can return. */
export function normalizeDefinitions(
	result: DefinitionResult,
): Array<{ uri: vscode.Uri; range: vscode.Range }> {
	if (!result) {
		return [];
	}
	const items = Array.isArray(result) ? result : [result];
	return items.map((item) => {
		if ('targetUri' in item) {
			return { uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange };
		}
		return { uri: item.uri, range: item.range };
	});
}

/**
 * Resolve hover types and definitions at `position` and read each definition's
 * source text. `lowConfidence` is set when neither provider returned anything.
 */
export async function gatherSemanticFacts(
	uri: vscode.Uri,
	position: vscode.Position,
	deps: SemanticDeps = {},
): Promise<SemanticFacts> {
	const exec = deps.exec ?? defaultExec;
	const readDefinition = deps.readDefinition ?? defaultReadDefinition;

	const hovers =
		(await exec<vscode.Hover[]>('vscode.executeHoverProvider', uri, position)) ?? [];
	const defResult = await exec<DefinitionResult>(
		'vscode.executeDefinitionProvider',
		uri,
		position,
	);

	const hoverTexts = extractHoverTexts(hovers);

	const definitions: ResolvedDefinition[] = [];
	for (const def of normalizeDefinitions(defResult)) {
		let text = '';
		try {
			text = (await readDefinition(def.uri, def.range)).trim();
		} catch {
			text = '';
		}
		definitions.push({ uri: def.uri, range: def.range, text });
	}

	const lowConfidence = hoverTexts.length === 0 && definitions.length === 0;
	return { hoverTexts, definitions, lowConfidence };
}

/**
 * Fold resolved semantic facts into the deep-dive context. Returns the combined
 * context plus the propagated `lowConfidence` flag.
 */
export function foldSemanticsIntoContext(
	facts: SemanticFacts,
	baseContext = '',
): { context: string; lowConfidence: boolean } {
	const blocks: string[] = [];

	if (baseContext.trim()) {
		blocks.push(baseContext.trim());
	}

	if (facts.hoverTexts.length > 0) {
		blocks.push(
			['Resolved type information:', ...facts.hoverTexts.map((t) => `- ${t}`)].join('\n'),
		);
	}

	if (facts.definitions.length > 0) {
		const defBlocks = facts.definitions.map((def) => {
			const loc = `${def.uri.fsPath}:${def.range.start.line + 1}`;
			return `Defined at ${loc}:\n${def.text}`;
		});
		blocks.push(['Resolved definitions:', ...defBlocks].join('\n\n'));
	}

	if (facts.lowConfidence) {
		blocks.push(LOW_CONFIDENCE_MARKER);
	}

	return { context: blocks.join('\n\n'), lowConfidence: facts.lowConfidence };
}
