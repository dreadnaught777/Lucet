# Lucet

A VS Code extension that adds code-explaining features, built on the Claude Agent SDK.

Lucet explains any line or block of code on hover, backed by the author's Claude Max
subscription. It is a personal, single-user reading aid — not a product. The full build
brief is in [`code-lens-ai-spec.md`](./code-lens-ai-spec.md); contributor conventions are
in [`CLAUDE.md`](./CLAUDE.md).

## Explanation tiers

- **Glance** — hover, no modifier. One or two sentences on the smallest enclosing AST node.
- **Deep dive** — hold a modifier (default `Alt`) while hovering. Structured breakdown of the
  enclosing function.
- **Why** — a panel affordance. Comparative analysis: alternatives, trade-offs, and fit to the
  project, with cited project facts.
- **As Python** — renders a non-Python unit as idiomatic Python, as a reading aid.

## Architecture

Everything runs in the VS Code extension host — no server, no database. TypeScript, Node 20+.

- `analysis/` — the one warm Agent SDK session, credential stripping, prompts.
- `structure/` — `web-tree-sitter` node selection + VS Code provider semantics.
- `context/`, `cache/`, `ui/` — context assembly, the result cache, and rendering.
- `grammars/` — bundled tree-sitter `.wasm` grammars, resolved from the extension dir.

## Settings

`lucet.dwellMs` (default 400), `lucet.modifier` (default `alt`), `lucet.languages`
(default `["typescript","javascript","python"]`), and the per-tier model settings. See the
manifest contract in the spec for the full list.

## Developing

```
npm install
npm run watch        # compile in watch mode
npm test             # run the test suite
# press F5 to launch the Extension Development Host
```

One-time auth setup: install Claude Code (`npm i -g @anthropic-ai/claude-code`), run
`claude setup-token`, and confirm `ANTHROPIC_API_KEY` is unset so subscription OAuth wins.
