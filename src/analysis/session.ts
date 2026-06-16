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
	model?: string;
	maxTurns?: number;
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
 * Options for the why tier: the read-only tool set. Opt-in and slower, so
 * agentic retrieval latency is acceptable here.
 */
export function whySessionOptions(
	env: Env = process.env,
	model?: string,
	maxTurns?: number,
): SessionOptions {
	const opts: SessionOptions = { allowedTools: [...WHY_TOOLS], env: stripAnthropicCredentials(env) };
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

/** Start a why-tier session with the read-only tool set. */
export async function startWhySession(prompt: string, opts: StartOptions = {}) {
	const { query } = await import('@anthropic-ai/claude-agent-sdk');
	return query({
		prompt,
		options: whySessionOptions(opts.env ?? process.env, opts.model, opts.maxTurns),
	});
}

// --- Warm session (glance hot path) -----------------------------------------
// Cold-starting query() per hover spawns a Claude Code process each time, adding
// 1-2s before the model sees the prompt. Instead, open ONE streaming-input
// session and push a user message per hover, reading until that turn's result.

interface InputMessage {
	type: 'user';
	session_id: string;
	parent_tool_use_id: string | null;
	message: { role: 'user'; content: string };
}

interface StreamMessage {
	type?: string;
	message?: { content?: Array<{ type?: string; text?: string }> };
	total_cost_usd?: number;
	costUSD?: number;
}

/** A persistent, reused analysis session. Tool-free (allowedTools: []). */
export interface WarmSession {
	/** Spawn the underlying process now so the first ask() does not pay startup. */
	prewarm(): Promise<void>;
	/** Send one prompt and resolve with the turn's text and cost. */
	ask(prompt: string): Promise<{ text: string; costUSD: number }>;
	/** Close the underlying session and its process. */
	dispose(): void;
}

/** A pushable async iterable used as the SDK's streaming input. */
function createInputStream() {
	const buffer: InputMessage[] = [];
	let notify: (() => void) | null = null;
	let done = false;
	const iterable: AsyncIterable<InputMessage> = {
		async *[Symbol.asyncIterator]() {
			while (true) {
				if (buffer.length > 0) {
					yield buffer.shift() as InputMessage;
					continue;
				}
				if (done) {
					return;
				}
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
			}
		},
	};
	return {
		iterable,
		push(message: InputMessage) {
			buffer.push(message);
			const fn = notify;
			notify = null;
			fn?.();
		},
		close() {
			done = true;
			const fn = notify;
			notify = null;
			fn?.();
		},
	};
}

/**
 * Create a warm glance/deep-dive session (allowedTools: []). The session starts
 * lazily on the first `ask` and is reused for every subsequent call. Turns are
 * serialized so concurrent hovers do not interleave on the shared stream.
 */
export function createWarmSession(opts: StartOptions = {}): WarmSession {
	const env = opts.env ?? process.env;
	const input = createInputStream();
	let output: AsyncIterator<StreamMessage> | undefined;
	let starting: Promise<void> | undefined;
	let chain: Promise<unknown> = Promise.resolve();
	let disposed = false;

	const ensureStarted = (): Promise<void> => {
		if (!starting) {
			starting = (async () => {
				const { query } = await import('@anthropic-ai/claude-agent-sdk');
				const q = query({
					prompt: input.iterable as never,
					options: analysisSessionOptions(env, opts.model),
				});
				output = (q as AsyncIterable<StreamMessage>)[Symbol.asyncIterator]();
			})();
		}
		return starting;
	};


	const turn = async (prompt: string): Promise<{ text: string; costUSD: number }> => {
		if (disposed) {
			throw new Error('warm session disposed');
		}
		await ensureStarted();
		input.push({
			type: 'user',
			session_id: '',
			parent_tool_use_id: null,
			message: { role: 'user', content: prompt },
		});

		let text = '';
		let costUSD = 0;
		while (output) {
			const { value, done } = await output.next();
			if (done) {
				break;
			}
			if (value.type === 'assistant') {
				for (const block of value.message?.content ?? []) {
					if (block.type === 'text' && block.text) {
						text += block.text;
					}
				}
			} else if (value.type === 'result') {
				costUSD = value.total_cost_usd ?? value.costUSD ?? 0;
				break;
			}
		}
		return { text: text.trim(), costUSD };
	};

	return {
		prewarm() {
			// Construct the query and import the SDK now (non-blocking on output).
			// We must NOT consume the output stream here: in streaming-input mode the
			// SDK may not emit anything until the first user message, so draining would
			// deadlock. The first ask() still pays one process spawn; calls 2..N reuse it.
			return ensureStarted();
		},
		ask(prompt: string) {
			const result = chain.then(() => turn(prompt));
			// Keep the chain alive regardless of this turn's outcome.
			chain = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
		dispose() {
			disposed = true;
			input.close();
		},
	};
}
