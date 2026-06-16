// Lucet activation: registers the glance hover provider, the deep-dive command
// (with the why and as-Python affordances), the cost meter / status bar, and the
// clear-cache command. All model calls go through analysis/session.ts.
import * as vscode from 'vscode';
import * as path from 'path';

import { isSupportedLanguage, getParserFor } from './structure/parsers';
import { selectEnclosingFunction } from './structure/parser';
import { gatherSemanticFacts, foldSemanticsIntoContext } from './structure/semantics';
import { assembleWhyContext } from './context/rationale';
import {
	buildDeepDivePrompt,
	buildWhyPrompt,
	buildAsPythonPrompt,
	shouldShowAsPython,
	promptVersion,
} from './analysis/prompts';
import {
	startAnalysisSession,
	startWhySession,
	createWarmSession,
	type WarmSession,
} from './analysis/session';
import { collectResult } from './analysis/collect';
import {
	CacheStore,
	computeCacheKey,
	computeWhyCacheKey,
	computePythonViewCacheKey,
	getOrAnalyze,
} from './cache/store';
import { CostMeter } from './ui/meter';
import { createGlanceHoverProvider } from './ui/hover';
import { showDeepDivePanel, type DefinedAtLink } from './ui/panel';

// Decoration applied to the range an explanation is describing.
let dwellDecorationType: vscode.TextEditorDecorationType;

function config() {
	const c = vscode.workspace.getConfiguration('lucet');
	return {
		glanceModel: c.get<string>('glanceModel', 'claude-haiku-4-5-20251001'),
		deepDiveModel: c.get<string>('deepDiveModel', 'claude-opus-4-8'),
		pivotModel: c.get<string>('pivotModel', 'claude-sonnet-4-6'),
		pivotLanguage: c.get<string>('pivotLanguage', 'python'),
		monthlyCreditUSD: c.get<number>('monthlyCreditUSD', 100),
		whyRetrievalSteps: c.get<number>('whyRetrievalSteps', 6),
		languages: c.get<string[]>('languages', ['typescript', 'javascript', 'python']),
	};
}

export function activate(context: vscode.ExtensionContext) {
	const extensionDir = context.extensionPath;

	dwellDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('editor.hoverHighlightBackground'),
		isWholeLine: false,
	});

	const store = new CacheStore(path.join(context.globalStorageUri.fsPath, 'cache.json'));
	const meter = new CostMeter();

	// Status-bar cost meter (personal visibility; no hard cap — credit pool paused).
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBar.command = 'lucet.clearCache';
	const refreshMeter = () => {
		statusBar.text = `$(graph) ${meter.format(config().monthlyCreditUSD)}`;
		statusBar.tooltip = 'Lucet month-to-date spend (estimate)';
	};
	refreshMeter();
	statusBar.show();

	// Clear the explanation cache (does NOT reset the spend meter — independent).
	const clearCache = vscode.commands.registerCommand('lucet.clearCache', () => {
		store.clear();
		vscode.window.showInformationMessage('Lucet: explanation cache cleared.');
	});

	// One warm glance session, reused across hovers (recreated only if the model
	// setting changes). Cold-starting query() per hover is the latency killer.
	let glanceSession: WarmSession | undefined;
	let glanceSessionModel: string | undefined;
	const glanceSessionFor = (model: string): WarmSession => {
		if (!glanceSession || glanceSessionModel !== model) {
			glanceSession?.dispose();
			glanceSession = createWarmSession({ model });
			glanceSessionModel = model;
		}
		return glanceSession;
	};

	// Spawn the glance session process now so the first hover skips startup.
	void glanceSessionFor(config().glanceModel).prewarm();

	// Glance: model-backed hover via the warm session.
	const hoverProvider = createGlanceHoverProvider({
		extensionDir,
		store,
		meter,
		decoration: dwellDecorationType,
		glanceModel: () => config().glanceModel,
		askGlance: (prompt) => glanceSessionFor(config().glanceModel).ask(prompt),
		onMeterChanged: refreshMeter,
	});
	const hoverRegistration = vscode.languages.registerHoverProvider(
		config().languages,
		hoverProvider,
	);

	// Clear the highlight when the cursor moves / the tooltip is dismissed.
	const clearOnMove = vscode.window.onDidChangeTextEditorSelection((e) => {
		e.textEditor.setDecorations(dwellDecorationType, []);
	});

	vscode.commands.executeCommand('setContext', 'lucet.deepDiveAvailable', true);

	const deepDive = vscode.commands.registerCommand('lucet.deepDive', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		const doc = editor.document;
		const parserPromise = getParserFor(extensionDir, doc.languageId);
		if (!isSupportedLanguage(doc.languageId) || !parserPromise) {
			vscode.window.showInformationMessage(`Lucet: no grammar for ${doc.languageId}.`);
			return;
		}

		const parser = await parserPromise;
		const source = doc.getText();
		const tree = parser.parse(source);
		if (!tree) {
			return;
		}
		const unit = selectEnclosingFunction(tree.rootNode, doc.offsetAt(editor.selection.active));
		if (!unit) {
			return;
		}
		const code = source.slice(unit.startIndex, unit.endIndex);

		// Ground the deep dive in VS Code's resolved types/definitions.
		const facts = await gatherSemanticFacts(doc.uri, editor.selection.active);
		const { context } = foldSemanticsIntoContext(facts);
		const cfg = config();

		const deepKey = computeCacheKey({
			targetText: code,
			context,
			promptVersion,
			model: cfg.deepDiveModel,
			depth: 'deep',
		});
		const { value: body } = await getOrAnalyze(store, deepKey, async () => {
			const stream = await startAnalysisSession(
				buildDeepDivePrompt({ code, languageId: doc.languageId, context }),
				{ model: cfg.deepDiveModel },
			);
			const result = await collectResult(stream, meter);
			refreshMeter();
			return result.text;
		});

		// Highlight the explained unit.
		editor.setDecorations(dwellDecorationType, [
			new vscode.Range(doc.positionAt(unit.startIndex), doc.positionAt(unit.endIndex)),
		]);

		const definedAt: DefinedAtLink[] = facts.definitions.map((d) => ({
			label: `${path.basename(d.uri.fsPath)}:${d.range.start.line + 1}`,
			uri: d.uri,
			line: d.range.start.line,
			character: d.range.start.character,
		}));

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

		showDeepDivePanel({
			title: 'Lucet: Deep Dive',
			body,
			definedAt,
			showAsPython: shouldShowAsPython(doc.languageId, cfg.pivotLanguage),
			onExplainWhy: async () => {
				const whyCtx = workspaceRoot
					? assembleWhyContext(workspaceRoot)
					: { text: '', dependencies: [], dependencyManifestHash: '' };
				const whyKey = computeWhyCacheKey({
					targetText: code,
					dependencyManifestHash: whyCtx.dependencyManifestHash,
					promptVersion,
				});
				const { value } = await getOrAnalyze(store, whyKey, async () => {
					const stream = await startWhySession(
						buildWhyPrompt({ code, languageId: doc.languageId, context: whyCtx.text }),
						{ model: cfg.deepDiveModel, maxTurns: cfg.whyRetrievalSteps },
					);
					const result = await collectResult(stream, meter);
					refreshMeter();
					return result.text;
				});
				return value;
			},
			onShowAsPython: async () => {
				const pythonKey = computePythonViewCacheKey({
					targetText: code,
					pivotLanguage: cfg.pivotLanguage,
					promptVersion,
				});
				const { value } = await getOrAnalyze(store, pythonKey, async () => {
					const stream = await startAnalysisSession(
						buildAsPythonPrompt({ code, languageId: doc.languageId }, cfg.pivotLanguage),
						{ model: cfg.pivotModel },
					);
					const result = await collectResult(stream, meter);
					refreshMeter();
					return result.text;
				});
				return value;
			},
		});
	});

	// Lightweight liveness check kept from M0.
	const ping = vscode.commands.registerCommand('lucet.ping', () => {
		vscode.window.showInformationMessage('Lucet: pong');
	});
	const hello = vscode.commands.registerCommand('lucet.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Lucet!');
	});

	context.subscriptions.push(
		dwellDecorationType,
		statusBar,
		clearCache,
		hoverRegistration,
		clearOnMove,
		deepDive,
		ping,
		hello,
		{ dispose: () => glanceSession?.dispose() },
	);
}

export function deactivate() {}
