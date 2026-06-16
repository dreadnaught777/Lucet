// Helpers for building a sanitized environment for analysis sessions.
//
// The Claude Agent SDK is given an explicit `env` so that the spawned process
// does not inherit Anthropic credentials from the host. Stripping these forces
// the SDK to rely on the configured authentication path rather than leaking the
// user's personal API key / auth token into analysis sessions.
//
// The strip list also covers variables that would silently redirect SDK
// traffic to a non-Anthropic endpoint (proxies, TLS relaxers, alternate clouds).
// If the user has any of these set globally, we want analysis to use the
// subscription path or fail — not exfiltrate code to an unintended host.

/** Environment variable names that must never be forwarded to a session. */
export const STRIPPED_CREDENTIAL_KEYS = [
	// Direct credentials — would bill a pay-as-you-go account instead of the Max plan.
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	// SDK endpoint redirectors — would route analysis traffic to a non-Anthropic server.
	'ANTHROPIC_BASE_URL',
	'ANTHROPIC_DEFAULT_HEADERS',
	// Cross-cloud routing — would bill (and send code to) a different provider.
	'CLAUDE_CODE_USE_BEDROCK',
	'CLAUDE_CODE_USE_VERTEX',
	// Proxy variables — would route SDK traffic through an arbitrary intermediary.
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'ALL_PROXY',
	'http_proxy',
	'https_proxy',
	'all_proxy',
	// TLS relaxers — would let an intermediary MITM the SDK's TLS connection.
	'NODE_TLS_REJECT_UNAUTHORIZED',
	'NODE_EXTRA_CA_CERTS',
] as const;

export type Env = { [key: string]: string | undefined };

/**
 * Return a shallow copy of `env` with all Anthropic credential and traffic-
 * redirecting variables removed. The input object is not mutated.
 */
export function stripAnthropicCredentials(env: Env): Env {
	const sanitized: Env = { ...env };
	for (const key of STRIPPED_CREDENTIAL_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
}
