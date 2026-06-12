// Thin wrapper around the Claude Agent SDK used to run read-only code analysis.
import { stripAnthropicCredentials, Env } from './env';

/**
 * Start an analysis session for the given prompt.
 *
 * Tool use is fully disabled (`allowedTools: []`) so the model can only reason
 * about the supplied prompt, and Anthropic credentials are stripped from the
 * environment handed to the SDK.
 *
 * The SDK is an ES module, so it is loaded via dynamic import from this
 * CommonJS extension.
 */
export async function startAnalysisSession(prompt: string, env: Env = process.env) {
	const { query } = await import('@anthropic-ai/claude-agent-sdk');
	return query({
		prompt,
		options: {
			allowedTools: [],
			env: stripAnthropicCredentials(env),
		},
	});
}
