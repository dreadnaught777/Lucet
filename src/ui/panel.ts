// Deep-dive UI: a single reused WebviewPanel. Renders the five fixed sections as
// collapsible <details>, makes resolved "Defined at" entries clickable, and hosts
// the "Explain why" and "Show as Python" affordances. Plain HTML/CSS/JS — no framework.
import * as crypto from 'crypto';
import * as vscode from 'vscode';

const VIEW_TYPE = 'lucet.deepDive';

export interface DefinedAtLink {
	label: string;
	uri: vscode.Uri;
	line: number;
	character: number;
}

export interface DeepDiveView {
	title: string;
	/** The model's deep-dive output (Markdown with the five `## ` headers). */
	body: string;
	/** Resolved definitions to render as clickable links. */
	definedAt: DefinedAtLink[];
	/** Whether to offer the "Show as Python" button. */
	showAsPython: boolean;
	/** Run the why tier; resolves to text appended below the breakdown. */
	onExplainWhy: () => Promise<string>;
	/** Run the as-Python tier; resolves to a Python rendering + caveats. */
	onShowAsPython: () => Promise<string>;
}

/** Split deep-dive Markdown into `## ` sections, preserving order. */
export function splitMarkdownSections(md: string): Array<{ header: string; body: string }> {
	const sections: Array<{ header: string; body: string }> = [];
	let current: { header: string; body: string } | null = null;
	for (const line of md.split(/\r?\n/)) {
		const m = /^##\s+(.*)$/.exec(line);
		if (m) {
			current = { header: m[1].trim(), body: '' };
			sections.push(current);
		} else if (current) {
			current.body += (current.body ? '\n' : '') + line;
		}
	}
	return sections.map((s) => ({ header: s.header, body: s.body.trim() }));
}

let panel: vscode.WebviewPanel | undefined;
let current: DeepDiveView | undefined;
let messageSub: vscode.Disposable | undefined;

/**
 * Escape a string for safe HTML interpolation in either element content or
 * attribute-value position. Covers all five HTML-spec characters; the prior
 * version omitted quotes, which broke `data-uri="${escapeHtml(...)}"` safety.
 * Exported for unit testing.
 */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Generate a CSP nonce. Must be unpredictable per render — a predictable
 * value defeats the point, since an attacker who can guess it could ship an
 * inline script that the CSP would then execute. `randomBytes` is the right
 * primitive; the prior `Date.now()` derivation was guessable.
 */
function nonce(): string {
	return crypto.randomBytes(16).toString('base64url');
}

/** Show (or refresh) the deep-dive panel for a view. */
export function showDeepDivePanel(view: DeepDiveView): vscode.WebviewPanel {
	current = view;
	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			VIEW_TYPE,
			view.title,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		panel.onDidDispose(() => {
			panel = undefined;
			current = undefined;
			messageSub?.dispose();
			messageSub = undefined;
		});
	}

	messageSub?.dispose();
	messageSub = panel.webview.onDidReceiveMessage((msg) => handleMessage(msg));

	panel.title = view.title;
	panel.webview.html = renderHtml(panel.webview, view);
	panel.reveal(vscode.ViewColumn.Beside, true);
	return panel;
}

/** Dismiss the deep-dive panel, if open. */
export function disposeDeepDivePanel(): void {
	panel?.dispose();
	panel = undefined;
	current = undefined;
}

/**
 * URI schemes safe to hand to `vscode.open` from a webview `data-uri`. We
 * accept only file-resource schemes — `command:` URIs in particular would let
 * a tampered `data-uri` invoke arbitrary VS Code commands.
 */
const ALLOWED_OPEN_SCHEMES = new Set(['file', 'untitled', 'vscode-remote']);

async function handleMessage(msg: { type?: string; line?: number; character?: number; uri?: string }): Promise<void> {
	if (!current || !panel) {
		return;
	}
	try {
		if (msg.type === 'open' && msg.uri) {
			const uri = vscode.Uri.parse(msg.uri);
			if (!ALLOWED_OPEN_SCHEMES.has(uri.scheme)) {
				// Drop silently; the webview should never produce a non-file URI.
				return;
			}
			const pos = new vscode.Position(msg.line ?? 0, msg.character ?? 0);
			await vscode.commands.executeCommand('vscode.open', uri, {
				selection: new vscode.Range(pos, pos),
			});
		} else if (msg.type === 'explainWhy') {
			panel.webview.postMessage({ type: 'status', target: 'why', text: 'Analysing…' });
			const text = await current.onExplainWhy();
			panel.webview.postMessage({ type: 'append', target: 'why', text });
		} else if (msg.type === 'showAsPython') {
			panel.webview.postMessage({ type: 'status', target: 'python', text: 'Rendering…' });
			const text = await current.onShowAsPython();
			panel.webview.postMessage({ type: 'append', target: 'python', text });
		}
	} catch (err) {
		const text = err instanceof Error ? err.message : String(err);
		const target = msg.type === 'showAsPython' ? 'python' : 'why';
		panel.webview.postMessage({ type: 'status', target, text: `Unavailable: ${text}` });
	}
}

function renderHtml(webview: vscode.Webview, view: DeepDiveView): string {
	const n = nonce();
	const sections = splitMarkdownSections(view.body);
	const sectionHtml = sections.length
		? sections
				.map(
					(s) =>
						`<details open><summary>${escapeHtml(s.header)}</summary><pre>${escapeHtml(s.body)}</pre></details>`,
				)
				.join('\n')
		: `<pre>${escapeHtml(view.body)}</pre>`;

	const definedAtHtml = view.definedAt.length
		? `<details open><summary>Defined at</summary><ul>${view.definedAt
				.map(
					(d) =>
						`<li><a href="#" class="defined-at" data-uri="${escapeHtml(d.uri.toString())}" data-line="${d.line}" data-character="${d.character}">${escapeHtml(d.label)}</a></li>`,
				)
				.join('')}</ul></details>`
		: '';

	const pythonButton = view.showAsPython
		? `<button id="btn-python">Show as Python</button>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';" />
	<title>${escapeHtml(view.title)}</title>
	<style>
		body { font-family: var(--vscode-font-family); padding: 0 1rem; line-height: 1.5; }
		summary { cursor: pointer; font-weight: 600; }
		pre { white-space: pre-wrap; word-wrap: break-word; }
		.toolbar { margin: 0.5rem 0; display: flex; gap: 0.5rem; }
		button { cursor: pointer; }
		.illustrative { font-style: italic; opacity: 0.8; }
		#python-result code { display: block; white-space: pre-wrap; }
	</style>
</head>
<body>
	${sectionHtml}
	${definedAtHtml}
	<div class="toolbar">
		<button id="btn-why">Explain why</button>
		${pythonButton}
	</div>
	<div id="why-result"></div>
	<div id="python-result"></div>
	<script nonce="${n}">
		const vscodeApi = acquireVsCodeApi();
		document.getElementById('btn-why')?.addEventListener('click', () => vscodeApi.postMessage({ type: 'explainWhy' }));
		document.getElementById('btn-python')?.addEventListener('click', () => vscodeApi.postMessage({ type: 'showAsPython' }));
		document.querySelectorAll('a.defined-at').forEach((a) => a.addEventListener('click', (e) => {
			e.preventDefault();
			vscodeApi.postMessage({ type: 'open', uri: a.dataset.uri, line: Number(a.dataset.line), character: Number(a.dataset.character) });
		}));
		// All host-supplied content is rendered via textContent so the browser
		// never parses it as HTML. innerHTML is not used for dynamic content.
		function renderStatus(el, text) {
			el.replaceChildren();
			const p = document.createElement('p');
			p.className = 'illustrative';
			p.textContent = text;
			el.appendChild(p);
		}
		function renderAppend(el, target, text) {
			el.replaceChildren();
			if (target === 'python') {
				const note = document.createElement('p');
				note.className = 'illustrative';
				note.textContent = 'Illustrative Python — not a runnable port.';
				el.appendChild(note);
			} else {
				const h = document.createElement('h3');
				h.textContent = 'Why';
				el.appendChild(h);
			}
			const pre = document.createElement('pre');
			pre.textContent = text;
			el.appendChild(pre);
		}
		window.addEventListener('message', (event) => {
			const m = event.data;
			const el = document.getElementById(m.target + '-result');
			if (!el) return;
			const text = typeof m.text === 'string' ? m.text : '';
			if (m.type === 'status') renderStatus(el, text);
			else if (m.type === 'append') renderAppend(el, m.target, text);
		});
	</script>
</body>
</html>`;
}
