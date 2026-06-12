import * as assert from 'assert';

import { CostMeter, extractCostUSD } from '../ui/meter';

suite('ui/meter Test Suite', () => {
	test('extractCostUSD reads total_cost_usd and the costUSD alias', () => {
		assert.strictEqual(extractCostUSD({ total_cost_usd: 0.012 }), 0.012);
		assert.strictEqual(extractCostUSD({ costUSD: 0.5 }), 0.5);
		assert.strictEqual(extractCostUSD({}), 0);
		assert.strictEqual(extractCostUSD(undefined), 0);
		assert.strictEqual(extractCostUSD({ total_cost_usd: -1 }), 0);
	});

	test('accumulates costUSD across sample result messages', () => {
		const meter = new CostMeter(() => new Date(2026, 5, 12)); // June 2026
		meter.record({ total_cost_usd: 0.01 });
		meter.record({ total_cost_usd: 0.02 });
		meter.record({ costUSD: 0.03 });

		assert.ok(Math.abs(meter.monthToDateUSD - 0.06) < 1e-9);
	});

	test('resets the total when the calendar month changes', () => {
		let current = new Date(2026, 5, 30); // 30 June 2026
		const meter = new CostMeter(() => current);

		meter.record({ total_cost_usd: 0.05 });
		meter.record({ total_cost_usd: 0.05 });
		assert.ok(Math.abs(meter.monthToDateUSD - 0.1) < 1e-9, 'June total accumulated');
		assert.strictEqual(meter.period, '2026-06');

		// Advance into July: the next interaction starts a fresh month.
		current = new Date(2026, 6, 1); // 1 July 2026
		const newTotal = meter.record({ total_cost_usd: 0.02 });

		assert.ok(Math.abs(newTotal - 0.02) < 1e-9, 'July total excludes June spend');
		assert.ok(Math.abs(meter.monthToDateUSD - 0.02) < 1e-9);
		assert.strictEqual(meter.period, '2026-07');
	});

	test('format renders spend against the monthly credit', () => {
		const meter = new CostMeter(() => new Date(2026, 5, 12));
		meter.record({ total_cost_usd: 1.5 });
		assert.strictEqual(meter.format(100), '$1.50 / $100');
	});
});
