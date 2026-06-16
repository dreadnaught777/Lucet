// Glance tier: live, model-backed hover. Selects the smallest enclosing AST node,
// assembles a small context, checks the cache, and only calls the model on a miss.
import * as vscode from 'vscode';

import { getParserFor, isSupportedLanguage } from '../structure/parsers';
import { selectNode } from '../structure/parser';
import { assembleGlanceContext } from '../context/assembler';
import { computeCacheKey, getOrAnalyze, CacheStore } from '../cache/store';
import { buildGlancePrompt, promptVersion } from '../analysis/prompts';
import { startAnalysisSession } from '../analysis/session';
import { collectResult } from '../analysis/collect';
import { CostMeter } from './meter';

export interface GlanceServices {
	extensionDir: string;
	store: CacheStore;
	meter: CostMeter;
	decoration: vscode.TextEditorDecorationType;
	glanceModel: () => string;
	onMeterChanged: () => void;
}

/** Build the glance hover provider wired to the shared services. */
export function createGlanceHoverProvider(services: GlanceServices): vscode.HoverProvider {
	return {
		async provideHover(document, position, token) {
			if (!isSupportedLanguage(document.languageId)) {
				return undefined;
			}
			const parserPromise = getParserFor(services.extensionDir, document.languageId);
			if (!parserPromise) {
				return undefined;
			}

			const parser = await parserPromise;
			if (token.isCancellationRequested) {
				return undefined;
			}

			const source = document.getText();
			const tree = parser.parse(source);
			if (!tree) {
				return undefined;
			}
			const selected = selectNode(tree.rootNode, document.offsetAt(position));
			if (!selected) {
				return undefined;
			}

			const { targetText, context } = assembleGlanceContext(
				source,
				selected.startIndex,
				selected.endIndex,
			);
			const model = services.glanceModel();
			const key = computeCacheKey({
				targetText,
				context,
				promptVersion,
				model,
				depth: 'glance',
			});

			const { value } = await getOrAnalyze(services.store, key, async () => {
				const stream = await startAnalysisSession(
					buildGlancePrompt({ code: targetText, languageId: document.languageId, context }),
					{ model },
				);
				const result = await collectResult(stream, services.meter);
				services.onMeterChanged();
				return result.text;
			});

			if (token.isCancellationRequested) {
				return undefined;
			}

			const range = new vscode.Range(
				document.positionAt(selected.startIndex),
				document.positionAt(selected.endIndex),
			);

			// Highlight the exact node range while the tooltip is visible.
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document === document) {
				editor.setDecorations(services.decoration, [range]);
			}

			return new vscode.Hover(new vscode.MarkdownString(value), range);
		},
	};
}
