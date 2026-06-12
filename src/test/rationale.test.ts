import * as assert from 'assert';
import * as path from 'path';

import { assembleWhyContext, dependsOn } from '../context/rationale';

const FIXTURE_REPO = path.resolve(
	__dirname,
	'..',
	'..',
	'src',
	'test',
	'fixtures',
	'sample-repo',
);

suite('context/rationale Test Suite', () => {
	test('surfaces the lodash dependency in the assembled why-context', () => {
		const ctx = assembleWhyContext(FIXTURE_REPO);

		assert.ok(ctx.text.includes('lodash'), 'lodash present in rendered context');
		assert.ok(ctx.text.includes('lodash@^4.17.21'), 'lodash version surfaced');
		assert.ok(dependsOn(ctx, 'lodash'), 'dependsOn detects lodash');
		assert.strictEqual(
			ctx.dependencies.find((d) => d.name === 'lodash')?.dev,
			false,
			'lodash is a runtime dependency',
		);
	});

	test('captures dev dependencies and a manifest hash for the cache key', () => {
		const ctx = assembleWhyContext(FIXTURE_REPO);

		assert.ok(dependsOn(ctx, 'typescript'), 'dev dependency captured');
		assert.strictEqual(
			ctx.dependencies.find((d) => d.name === 'typescript')?.dev,
			true,
		);
		assert.match(ctx.dependencyManifestHash, /^[0-9a-f]{64}$/, 'sha256 manifest hash');
	});

	test('missing manifest yields an empty, safe context', () => {
		const ctx = assembleWhyContext(path.join(FIXTURE_REPO, 'does-not-exist'));
		assert.strictEqual(ctx.dependencies.length, 0);
		assert.strictEqual(ctx.dependencyManifestHash, '');
	});
});
