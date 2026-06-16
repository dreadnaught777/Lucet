// Thin wrapper around the Claude Agent SDK used to run code analysis.
//
// Tool access is tiered and is the permission boundary:
//   - glance / deep-dive: allowedTools: []  (answer only from assembled context)
//   - why:                Read, Grep, Glob, Bash  (opt-in, read-only retrieval)
// Anthropic credentials are stripped from the env handed to the SDK on every tier.
//
// On the why tier, `Bash` is further constrained by `canUseTool` to read-only
// git operations only. The model's prompt instructs git use, but the prompt is
// not a security boundary — a malicious source file or manifest could inject
// instructions to run arbitrary shell. `canUseTool` is the enforcement layer.
import { stripAnthropicCredentials, Env } from './env';

/**
 * Result of a {@link CanUseTool} decision. Structurally matches the Agent
 * SDK's `PermissionResult`; declared locally so this CJS module need not
 * cross the CJS/ESM type-import boundary into the SDK's `.d.ts`.
 */
export type PermissionResult =
	| { behavior: 'allow'; updatedInput?: Record<string, unknown> }
	| { behavior: 'deny'; message: string };

/**
 * Permission callback shape. Structurally compatible with the SDK's `CanUseTool`
 * type; the third parameter is loosened to `unknown` since this codebase does
 * not read the SDK-provided suggestions or signal.
 */
export type CanUseTool = (
	toolName: string,
	input: Record<string, unknown>,
	options: unknown,
) => Promise<PermissionResult>;

/**
 * The why tier's read-only tool set. `Bash` is included for restricted git use
 * (blame/log/show); the analysis layer never grants `Write` or `Edit`. Bash
 * commands are filtered further by {@link isAllowedWhyBashCommand}.
 */
export const WHY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'] as const;

/** Read-only git verbs the why tier may invoke via Bash. */
export const ALLOWED_GIT_VERBS = new Set<string>([
	'blame',
	'log',
	'show',
	'diff',
	'status',
	'ls-files',
	'ls-tree',
	'rev-parse',
	'rev-list',
	'cat-file',
	'shortlog',
	'describe',
]);

/**
 * Shell metacharacters that allow command chaining, substitution, redirects,
 * subshells, brace expansion, or escape. Reject any Bash command containing
 * one of these — the deny decision is then independent of shell-quoting nuance.
 */
const SHELL_META_REGEX = /[;&|`$<>(){}\n\r\\]/;

/**
 * Pre-verb global flags that change git's working tree, exec path, or config.
 * `-c name=value` is the canonical RCE vector (overrides `core.sshCommand`,
 * `core.editor`, etc. — see CVE-2017-1000117 family). Any pre-verb flag is
 * rejected; legitimate why-tier queries do not need them.
 */
function startsWithDash(token: string): boolean {
	return token.startsWith('-');
}

/**
 * True if `command` is a single read-only git invocation safe to execute in the
 * why tier. Rejects shell metacharacters, pre-verb global flags, and any verb
 * outside {@link ALLOWED_GIT_VERBS}. Pure — exported for unit testing.
 */
export function isAllowedWhyBashCommand(command: unknown): boolean {
	if (typeof command !== 'string') {
		return false;
	}
	const trimmed = command.trim();
	if (trimmed.length === 0) {
		return false;
	}
	if (SHELL_META_REGEX.test(trimmed)) {
		return false;
	}
	const tokens = trimmed.split(/\s+/);
	if (tokens.length < 2 || tokens[0] !== 'git') {
		return false;
	}
	// No pre-verb flags — the first token after `git` must be the verb.
	if (startsWithDash(tokens[1])) {
		return false;
	}
	return ALLOWED_GIT_VERBS.has(tokens[1]);
}

/**
 * `canUseTool` callback for the why tier. Read/Grep/Glob run as-is (the
 * `allowedTools` list already constrains them). Bash is gated by
 * {@link isAllowedWhyBashCommand}; everything else is denied.
 */
export const whyCanUseTool: CanUseTool = async (toolName, input) => {
	if (toolName === 'Bash') {
		const command = (input as { command?: unknown }).command;
		if (!isAllowedWhyBashCommand(command)) {
			const preview = typeof command === 'string' ? command.slice(0, 80) : String(command);
			const result: PermissionResult = {
				behavior: 'deny',
				message:
					'Lucet why-tier policy: Bash is restricted to read-only git commands ' +
					`(${[...ALLOWED_GIT_VERBS].join(', ')}) with no shell metacharacters or ` +
					`pre-verb flags. Rejected: ${preview}`,
			};
			return result;
		}
	}
	return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
};

interface SessionOptions {
	allowedTools: string[];
	env: Env;
	model?: string;
	maxTurns?: number;
	canUseTool?: CanUseTool;
}

/**
 * Options for the glance and deep-dive tiers: NO tools. These tiers must answer
 * only from the context we assemble — fast, predictable, no wandering. An optional
 * `model` selects the per-tier model (glance/deep-dive/as-Python).
 */
export function analysisSessionOptions(env: Env = process.env, model?: string): SessionOptions {
	const opts: SessionOptions = { allowedTools: [], env: stripAnthropicCredentials(env) };
	if (model) {
		opts.model = model;
	}
	return opts;
}

/**
 * Options for the why tier: the read-only tool set, plus a `canUseTool`
 * callback that restricts Bash to read-only git commands.
 */
export function whySessionOptions(
	env: Env = process.env,
	model?: string,
	maxTurns?: number,
): SessionOptions {
	const opts: SessionOptions = {
		allowedTools: [...WHY_TOOLS],
		env: stripAnthropicCredentials(env),
		canUseTool: whyCanUseTool,
	};
	if (model) {
		opts.model = model;
	}
	// Bound agentic retrieval so one expansion cannot crawl the whole repo.
	if (typeof maxTurns === 'number' && maxTurns > 0) {
		opts.maxTurns = maxTurns;
	}
	return opts;
}

export interface StartOptions {
	env?: Env;
	model?: string;
	maxTurns?: number;
}

/**
 * Start a glance / deep-dive / as-Python session (allowedTools: []). The SDK is an
 * ES module, loaded via dynamic import from this CommonJS extension.
 */
export async function startAnalysisSession(prompt: string, opts: StartOptions = {}) {
	const { query } = await import('@anthropic-ai/claude-agent-sdk');
	return query({ prompt, options: analysisSessionOptions(opts.env ?? process.env, opts.model) });
}

/** Start a why-tier session with the read-only tool set and Bash gating. */
export async function startWhySession(prompt: string, opts: StartOptions = {}) {
	const { query } = await import('@anthropic-ai/claude-agent-sdk');
	return query({
		prompt,
		options: whySessionOptions(opts.env ?? process.env, opts.model, opts.maxTurns),
	});
}
