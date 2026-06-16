// Context assembler: builds the minimal per-depth context fed to the model.
// Glance is the cheap, common path — keep it small (target 500-1,500 tokens):
// the target node plus the imports/names it likely references.

export interface GlanceContext {
	/** Source text of the selected node — the unit being explained. */
	targetText: string;
	/** Compact supporting context (imports the unit may reference). */
	context: string;
}

const IMPORT_LINE = /^\s*(import\b|export\s+\{|export\s+\*|from\s|const\s+[\w$]+\s*=\s*require\()/;

/** Lines at the top of the file that look like imports, capped for size. */
export function collectImportLines(source: string, max = 20): string[] {
	const lines: string[] = [];
	for (const line of source.split(/\r?\n/)) {
		if (IMPORT_LINE.test(line)) {
			lines.push(line.trim());
			if (lines.length >= max) {
				break;
			}
		}
	}
	return lines;
}

/**
 * Assemble glance context for a node at `[startIndex, endIndex)` in `source`.
 * Returns the node text plus the file's import lines (the names it references).
 */
export function assembleGlanceContext(
	source: string,
	startIndex: number,
	endIndex: number,
): GlanceContext {
	const targetText = source.slice(startIndex, endIndex);
	const imports = collectImportLines(source);
	const context = imports.length > 0 ? `Imports in this file:\n${imports.join('\n')}` : '';
	return { targetText, context };
}
