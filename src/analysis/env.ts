// Helpers for building a sanitized environment for analysis sessions.
//
// The Claude Agent SDK is given an explicit `env` so that the spawned process
// does not inherit Anthropic credentials from the host. Stripping these forces
// the SDK to rely on the configured authentication path rather than leaking the
// user's personal API key / auth token into analysis sessions.

/** Environment variable names that must never be forwarded to a session. */
export const STRIPPED_CREDENTIAL_KEYS = [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
] as const;

export type Env = { [key: string]: string | undefined };

/**
 * Return a shallow copy of `env` with all Anthropic credential variables
 * removed. The input object is not mutated.
 */
export function stripAnthropicCredentials(env: Env): Env {
	const sanitized: Env = { ...env };
	for (const key of STRIPPED_CREDENTIAL_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
}
