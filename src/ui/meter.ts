// Cost meter: accumulates the month-to-date spend reported by Agent SDK result
// messages and resets at each month boundary. The credit is non-rollover, so the
// meter tracks one calendar month at a time. Treat the figure as an estimate.

/**
 * The cost-bearing shape of an Agent SDK result message. The SDK reports
 * `total_cost_usd`; `costUSD` is accepted as an alias for robustness.
 */
export interface CostBearingMessage {
	total_cost_usd?: number;
	costUSD?: number;
}

/** Extract a non-negative USD cost from a result message, or 0 if absent. */
export function extractCostUSD(message: CostBearingMessage | null | undefined): number {
	if (!message) {
		return 0;
	}
	const raw = message.total_cost_usd ?? message.costUSD ?? 0;
	return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** `YYYY-MM` key identifying the billing month of a date. */
function monthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Running month-to-date cost meter. Inject `now` for deterministic tests; it
 * defaults to the system clock. Recording or reading the total first rolls the
 * period over (and zeroes the total) if the calendar month has changed.
 */
export class CostMeter {
	private total = 0;
	private periodKey: string;

	constructor(private readonly now: () => Date = () => new Date()) {
		this.periodKey = monthKey(this.now());
	}

	private rolloverIfNeeded(): void {
		const key = monthKey(this.now());
		if (key !== this.periodKey) {
			this.periodKey = key;
			this.total = 0;
		}
	}

	/** Add a result message's cost to the running total and return the new total. */
	record(message: CostBearingMessage): number {
		this.rolloverIfNeeded();
		this.total += extractCostUSD(message);
		return this.total;
	}

	/** Month-to-date spend in USD (rolls over first if the month changed). */
	get monthToDateUSD(): number {
		this.rolloverIfNeeded();
		return this.total;
	}

	/** The current billing period, `YYYY-MM`. */
	get period(): string {
		this.rolloverIfNeeded();
		return this.periodKey;
	}

	/** Format the meter as `$<spent> / $<credit>` for the status bar. */
	format(monthlyCreditUSD: number): string {
		const spent = this.monthToDateUSD.toFixed(2);
		return `$${spent} / $${monthlyCreditUSD.toFixed(0)}`;
	}
}
