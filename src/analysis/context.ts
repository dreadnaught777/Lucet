// Builds the block of source lines surrounding a target location. This is the
// snippet handed to the analysis session when the user dwells over a symbol.

export interface SurroundingContext {
	/** The joined snippet of source lines. */
	text: string;
	/** First line included, 0-based and clamped to the document. */
	startLine: number;
	/** Last line included, 0-based and clamped to the document. */
	endLine: number;
	/** The line the request was anchored on, 0-based and clamped. */
	targetLine: number;
}

/**
 * Build a window of `radius` lines on either side of `targetLine`.
 *
 * Indices are clamped to the bounds of `lines`, so requesting context near the
 * top or bottom of a file simply returns a smaller window rather than throwing.
 *
 * @param lines       Document split into lines (no trailing newlines).
 * @param targetLine  0-based line to centre the window on.
 * @param radius      Number of lines to include before and after the target.
 */
export function buildSurroundingContext(
	lines: string[],
	targetLine: number,
	radius = 5,
): SurroundingContext {
	if (lines.length === 0) {
		return { text: '', startLine: 0, endLine: 0, targetLine: 0 };
	}

	const lastIndex = lines.length - 1;
	const clampedTarget = clamp(targetLine, 0, lastIndex);
	const safeRadius = Math.max(0, Math.trunc(radius));
	const startLine = clamp(clampedTarget - safeRadius, 0, lastIndex);
	const endLine = clamp(clampedTarget + safeRadius, 0, lastIndex);

	const text = lines.slice(startLine, endLine + 1).join('\n');

	return { text, startLine, endLine, targetLine: clampedTarget };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
