// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { buildSurroundingContext } from './analysis/context';

// Decoration applied to the range that an analysis hover is describing.
let dwellDecorationType: vscode.TextEditorDecorationType;

/** Read the languages the hover provider should be registered for. */
function getConfiguredLanguages(): string[] {
	const configured = vscode.workspace
		.getConfiguration('lucet')
		.get<string[]>('languages');
	return configured && configured.length > 0
		? configured
		: ['typescript', 'javascript'];
}

/** Read the configured dwell delay (milliseconds) before analysis triggers. */
function getDwellMs(): number {
	return vscode.workspace.getConfiguration('lucet').get<number>('dwellMs', 400);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "lucet" is now active!');

	dwellDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('editor.hoverHighlightBackground'),
		isWholeLine: false,
	});
	context.subscriptions.push(dwellDecorationType);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('lucet.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from Lucet!');
	});

	const ping = vscode.commands.registerCommand('lucet.ping', () => {
		vscode.window.showInformationMessage('Lucet: pong');
	});

	const hoverProvider: vscode.HoverProvider = {
		provideHover(document, position) {
			const lines = document.getText().split(/\r?\n/);
			const ctx = buildSurroundingContext(lines, position.line);

			// Highlight the line the hover is anchored on while it is visible.
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document === document) {
				const range = document.lineAt(ctx.targetLine).range;
				editor.setDecorations(dwellDecorationType, [range]);
			}

			const md = new vscode.MarkdownString();
			md.appendMarkdown(`**Lucet** — context (dwell ${getDwellMs()}ms)\n\n`);
			md.appendCodeblock(ctx.text, document.languageId);
			return new vscode.Hover(md);
		},
	};

	const hoverRegistration = vscode.languages.registerHoverProvider(
		getConfiguredLanguages(),
		hoverProvider,
	);

	context.subscriptions.push(disposable, ping, hoverRegistration);
}

// This method is called when your extension is deactivated
export function deactivate() {}
