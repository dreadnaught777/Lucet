import * as assert from 'assert';

import { stripAnthropicCredentials, STRIPPED_CREDENTIAL_KEYS } from '../analysis/env';

suite('analysis/env Test Suite', () => {
	test('strips ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN', () => {
		const input = {
			ANTHROPIC_API_KEY: 'sk-ant-secret',
			ANTHROPIC_AUTH_TOKEN: 'auth-secret',
			PATH: '/usr/bin',
			HOME: '/home/user',
		};

		const result = stripAnthropicCredentials(input);

		assert.strictEqual(result.ANTHROPIC_API_KEY, undefined);
		assert.strictEqual(result.ANTHROPIC_AUTH_TOKEN, undefined);
		assert.ok(!('ANTHROPIC_API_KEY' in result));
		assert.ok(!('ANTHROPIC_AUTH_TOKEN' in result));
	});

	test('strips SDK endpoint redirectors so traffic stays on the subscription path', () => {
		const input = {
			ANTHROPIC_BASE_URL: 'https://attacker.example/v1',
			ANTHROPIC_DEFAULT_HEADERS: '{"X-Inject":"yes"}',
			CLAUDE_CODE_USE_BEDROCK: '1',
			CLAUDE_CODE_USE_VERTEX: '1',
			PATH: '/usr/bin',
		};

		const result = stripAnthropicCredentials(input);

		assert.strictEqual(result.ANTHROPIC_BASE_URL, undefined);
		assert.strictEqual(result.ANTHROPIC_DEFAULT_HEADERS, undefined);
		assert.strictEqual(result.CLAUDE_CODE_USE_BEDROCK, undefined);
		assert.strictEqual(result.CLAUDE_CODE_USE_VERTEX, undefined);
		assert.strictEqual(result.PATH, '/usr/bin');
	});

	test('strips proxy variables (both case variants)', () => {
		const input = {
			HTTP_PROXY: 'http://attacker.example:8080',
			HTTPS_PROXY: 'http://attacker.example:8080',
			ALL_PROXY: 'socks5://attacker.example:1080',
			http_proxy: 'http://attacker.example:8080',
			https_proxy: 'http://attacker.example:8080',
			all_proxy: 'socks5://attacker.example:1080',
			PATH: '/usr/bin',
		};

		const result = stripAnthropicCredentials(input);

		for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
			assert.strictEqual(result[key], undefined, `${key} should be stripped`);
		}
		assert.strictEqual(result.PATH, '/usr/bin');
	});

	test('strips TLS relaxers so a proxy cannot MITM the SDK', () => {
		const input = {
			NODE_TLS_REJECT_UNAUTHORIZED: '0',
			NODE_EXTRA_CA_CERTS: '/tmp/attacker-ca.pem',
			PATH: '/usr/bin',
		};

		const result = stripAnthropicCredentials(input);

		assert.strictEqual(result.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
		assert.strictEqual(result.NODE_EXTRA_CA_CERTS, undefined);
	});

	test('preserves non-credential variables', () => {
		const input = { PATH: '/usr/bin', HOME: '/home/user' };

		const result = stripAnthropicCredentials(input);

		assert.strictEqual(result.PATH, '/usr/bin');
		assert.strictEqual(result.HOME, '/home/user');
	});

	test('does not mutate the input object', () => {
		const input = { ANTHROPIC_API_KEY: 'sk-ant-secret', PATH: '/usr/bin' };

		stripAnthropicCredentials(input);

		assert.strictEqual(input.ANTHROPIC_API_KEY, 'sk-ant-secret');
	});

	test('STRIPPED_CREDENTIAL_KEYS covers direct credentials, endpoint redirectors, proxies, and TLS relaxers', () => {
		const keys = new Set<string>(STRIPPED_CREDENTIAL_KEYS);
		const required = [
			'ANTHROPIC_API_KEY',
			'ANTHROPIC_AUTH_TOKEN',
			'ANTHROPIC_BASE_URL',
			'ANTHROPIC_DEFAULT_HEADERS',
			'CLAUDE_CODE_USE_BEDROCK',
			'CLAUDE_CODE_USE_VERTEX',
			'HTTP_PROXY',
			'HTTPS_PROXY',
			'ALL_PROXY',
			'http_proxy',
			'https_proxy',
			'all_proxy',
			'NODE_TLS_REJECT_UNAUTHORIZED',
			'NODE_EXTRA_CA_CERTS',
		];
		for (const k of required) {
			assert.ok(keys.has(k), `STRIPPED_CREDENTIAL_KEYS missing ${k}`);
		}
	});
});
