import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
	computeCacheKey,
	CacheStore,
	getOrAnalyze,
	type CacheKeyParts,
} from '../cache/store';

const BASE_PARTS: CacheKeyParts = {
	targetText: 'function add(a, b) { return a + b; }',
	context: 'enclosing scope',
	promptVersion: 1,
	model: 'claude-haiku-4-5-20251001',
	depth: 'glance',
};

function tempStorePath(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucet-cache-'));
	return path.join(dir, 'cache.json');
}

suite('cache/store Test Suite', () => {
	test('cache key is identical for identical inputs', () => {
		assert.strictEqual(computeCacheKey(BASE_PARTS), computeCacheKey({ ...BASE_PARTS }));
	});

	test('cache key differs when the target code changes', () => {
		const changed = { ...BASE_PARTS, targetText: BASE_PARTS.targetText + ' // edit' };
		assert.notStrictEqual(computeCacheKey(BASE_PARTS), computeCacheKey(changed));
	});

	test('store round-trips a value across instances', () => {
		const file = tempStorePath();
		const key = computeCacheKey(BASE_PARTS);

		const writer = new CacheStore(file);
		writer.set(key, 'an explanation');

		// A fresh instance reads it back from disk.
		const reader = new CacheStore(file);
		assert.strictEqual(reader.get(key), 'an explanation');
		assert.strictEqual(reader.has(key), true);
	});

	test('clear empties the store', () => {
		const file = tempStorePath();
		const store = new CacheStore(file);
		store.set('k', 'v');
		store.clear();
		assert.strictEqual(store.get('k'), undefined);
		assert.strictEqual(new CacheStore(file).get('k'), undefined);
	});

	test('a cache hit makes no query() call (stubbed session)', async () => {
		const file = tempStorePath();
		const key = computeCacheKey(BASE_PARTS);
		const store = new CacheStore(file);
		store.set(key, 'cached answer');

		// Stand-in for analysis/session.ts query().
		const session = {
			calls: 0,
			query(): Promise<string> {
				this.calls += 1;
				return Promise.resolve('fresh answer');
			},
		};

		const result = await getOrAnalyze(store, key, () => session.query());

		assert.strictEqual(result.cached, true);
		assert.strictEqual(result.value, 'cached answer');
		assert.strictEqual(session.calls, 0, 'query() must not be called on a cache hit');
	});

	test('a cache miss calls query() once and stores the result', async () => {
		const file = tempStorePath();
		const key = computeCacheKey(BASE_PARTS);
		const store = new CacheStore(file);

		const session = {
			calls: 0,
			query(): Promise<string> {
				this.calls += 1;
				return Promise.resolve('fresh answer');
			},
		};

		const result = await getOrAnalyze(store, key, () => session.query());

		assert.strictEqual(result.cached, false);
		assert.strictEqual(result.value, 'fresh answer');
		assert.strictEqual(session.calls, 1);
		assert.strictEqual(store.get(key), 'fresh answer');
	});
});
