// Drain an Agent SDK query() stream into text, feeding result-message cost into
// the meter. Keeping this in one place means every tier accounts cost the same way.
import type { CostMeter } from '../ui/meter';

interface AssistantTextBlock {
	type: string;
	text?: string;
}

interface StreamMessage {
	type: string;
	message?: { content?: AssistantTextBlock[] };
	total_cost_usd?: number;
	costUSD?: number;
}

export interface CollectedResult {
	text: string;
	costUSD: number;
}

/**
 * Accumulate assistant text from a query stream and record the result message's
 * cost into `meter` (if provided). Returns the trimmed text and the cost.
 */
export async function collectResult(
	stream: AsyncIterable<unknown>,
	meter?: CostMeter,
): Promise<CollectedResult> {
	let text = '';
	let costUSD = 0;

	for await (const raw of stream) {
		const message = raw as StreamMessage;
		if (message.type === 'assistant') {
			for (const block of message.message?.content ?? []) {
				if (block.type === 'text' && block.text) {
					text += block.text;
				}
			}
		} else if (message.type === 'result') {
			costUSD = message.total_cost_usd ?? message.costUSD ?? 0;
			if (meter) {
				meter.record(message);
			}
		}
	}

	return { text: text.trim(), costUSD };
}
