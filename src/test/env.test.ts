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

	test('STRIPPED_CREDENTIAL_KEYS lists both credentials', () => {
		assert.deepStrictEqual(
			[...STRIPPED_CREDENTIAL_KEYS].sort(),
			['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
		);
	});
});
