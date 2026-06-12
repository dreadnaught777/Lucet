// Deep-dive UI: a single reused WebviewPanel that renders the structured
// breakdown. Plain HTML/CSS — no framework, per the build brief.
import * as vscode from 'vscode';

const VIEW_TYPE = 'lucet.deepDive';

let panel: vscode.WebviewPanel | undefined;

/**
 * Show the deep-dive panel with the given Markdown body, creating it on first
 * use and reusing it afterwards. The panel opens beside the editor so the source
 * stays visible.
 */
export function showDeepDivePanel(title: string, markdownBody: string): vscode.WebviewPanel {
	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			title,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: false, retainContextWhenHidden: true },
		);
		panel.onDidDispose(() => {
			panel = undefined;
		});
	}

	panel.title = title;
	panel.webview.html = renderHtml(title, markdownBody);
	panel.reveal(vscode.ViewColumn.Beside, true);
	return panel;
}

/** Dismiss the deep-dive panel, if open (e.g. on modifier release). */
export function disposeDeepDivePanel(): void {
	panel?.dispose();
	panel = undefined;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function renderHtml(title: string, body: string): string {
	// The body is rendered as a preformatted Markdown block; this keeps the panel
	// dependency-free while the analysis layer produces Markdown with the fixed
	// section headers.
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
	<title>${escapeHtml(title)}</title>
	<style>
		body { font-family: var(--vscode-font-family); padding: 0 1rem; line-height: 1.5; }
		pre { white-space: pre-wrap; word-wrap: break-word; }
	</style>
</head>
<body>
	<pre>${escapeHtml(body)}</pre>
</body>
</html>`;
}
