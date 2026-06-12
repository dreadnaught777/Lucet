// Why-tier context assembly (convention sampling). The part that turns generic
// trade-offs into "fits THIS project" is the live codebase: above all the
// dependency manifest, because "hand-roll vs use a library" turns on what is
// already a dependency. Bounded, cheapest-first, and cached by the manifest hash.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface DependencyFact {
	name: string;
	version: string;
	dev: boolean;
}

export interface WhyContext {
	/** Rendered context block handed to the why session. */
	text: string;
	/** Dependencies discovered in the manifest. */
	dependencies: DependencyFact[];
	/** Coarse project fingerprint for the why cache key. */
	dependencyManifestHash: string;
}

/** Read and parse `<repoRoot>/package.json`, or null if absent/unreadable. */
function readManifest(repoRoot: string): { raw: string; json: Record<string, unknown> } | null {
	try {
		const raw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
		return { raw, json: JSON.parse(raw) as Record<string, unknown> };
	} catch {
		return null;
	}
}

function collectDeps(
	json: Record<string, unknown>,
	field: string,
	dev: boolean,
): DependencyFact[] {
	const section = json[field];
	if (!section || typeof section !== 'object') {
		return [];
	}
	return Object.entries(section as Record<string, string>).map(([name, version]) => ({
		name,
		version,
		dev,
	}));
}

/**
 * Assemble the why-tier context for a project. Surfaces the dependency manifest
 * (so a "hand-roll vs library" claim can point at an existing dependency such as
 * lodash) and a manifest hash for the cache key.
 */
export function assembleWhyContext(repoRoot: string): WhyContext {
	const manifest = readManifest(repoRoot);
	if (!manifest) {
		return { text: 'No dependency manifest found.', dependencies: [], dependencyManifestHash: '' };
	}

	const dependencies = [
		...collectDeps(manifest.json, 'dependencies', false),
		...collectDeps(manifest.json, 'devDependencies', true),
	];

	const dependencyManifestHash = crypto
		.createHash('sha256')
		.update(manifest.raw)
		.digest('hex');

	const lines: string[] = ['Project dependencies (from package.json):'];
	if (dependencies.length === 0) {
		lines.push('- (none declared)');
	} else {
		for (const dep of dependencies) {
			lines.push(`- ${dep.name}@${dep.version}${dep.dev ? ' (dev)' : ''}`);
		}
	}

	return { text: lines.join('\n'), dependencies, dependencyManifestHash };
}

/** True if the project declares a runtime or dev dependency named `name`. */
export function dependsOn(context: WhyContext, name: string): boolean {
	return context.dependencies.some((d) => d.name === name);
}
