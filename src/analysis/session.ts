// Thin wrapper around the Claude Agent SDK used to run code analysis.
//
// Tool access is tiered and is the permission boundary:
//   - glance / deep-dive: allowedTools: []  (answer only from assembled context)
//   - why:                Read, Grep, Glob, Bash  (opt-in, read-only retrieval)
// Anthropic credentials are stripped from the env handed to the SDK on every tier.
import { stripAnthropicCredentials, Env } from './env';

/**
 * The why tier's read-only tool set. `Bash` is included for restricted git use
 * (blame/log/show); the analysis layer never grants `Write` or `Edit`.
 */
export const WHY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'] as const;

interface SessionOptions {
	allowedTools: string[];
	env: Env;
}

/**
 * Options for the glance and deep-dive tiers: NO tools. These tiers must answer
 * only from the context we assemble — fast, predictable, no wandering.
 */
export function analysisSessionOptions(env: Env = process.env): SessionOptions {
	return { allowedTools: [], env: stripAnthropicCredentials(env) };
}

/**
 * Options for the why tier: the read-only tool set. Opt-in and slower, so
 * agentic retrieval latency is acceptable here.
 */
export function whySessionOptions(env: Env = process.env): SessionOptions {
	return { allowedTools: [...WHY_TOOLS], env: stripAnthropicCredentials(env) };
}

/**
 * Start a glance / deep-dive session. The SDK is an ES module, loaded via dynamic
 * import from this CommonJS extension.
 */
export async function startAnalysisSession(prompt: string, env: Env = process.env) {
	const { query } = await import('@anthropic-ai/claude-agent-sdk');
	return query({ prompt, options: analysisSessionOptions(env) });
}

/** Start a why-tier session with the read-only tool set. */
export async function startWhySession(prompt: string, env: Env = process.env) {
	const { query } = await import('@anthropic-ai/claude-agent-sdk');
	return query({ prompt, options: whySessionOptions(env) });
}
