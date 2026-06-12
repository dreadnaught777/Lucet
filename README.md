# Lucet

A VS Code extension that adds code-explaining features, built on the Claude Agent SDK.

Lucet explains any line or block of code on hover, backed by the author's Claude Max
subscription. It is a personal, single-user reading aid — not a product. The full build
brief is in [`code-lens-ai-spec.md`](./code-lens-ai-spec.md); contributor conventions are
in [`CLAUDE.md`](./CLAUDE.md).

## Status — work in progress

The building blocks are implemented and unit-tested (parsing/node selection,
semantic grounding, prompt builders, the result cache, the cost meter, and the
tiered tool config), but **the model-calling path is not yet wired end-to-end**.
Several key functions are currently stubs, held until the **15 June 2026** Agent
SDK credit/auth changes are confirmed (programmatic SDK usage moves to a separate
monthly credit; subscription-OAuth precedence and Haiku selectability need
re-verifying before live `query()` calls go in). Specifically still stubbed:

- **Glance** hover renders the surrounding source context, not a model-generated
  explanation — no `query()` call in the hover path yet.
- **Deep dive** opens the panel with the fixed section scaffold and the assembled
  prompt (in an HTML comment); it does not yet call the model or stream a result.
- The warm session wrappers (`startAnalysisSession` / `startWhySession`) exist and
  are tool-tier-correct, but are not yet invoked from the hover/command flows, so
  nothing is parsed → cached → metered end-to-end.
- The **cost meter** accumulates correctly but is not yet fed real result messages
  or bound to a status-bar item.
- The **Why** and **As Python** tiers have prompt builders, validation, and cache
  keys, but no panel buttons or session wiring.

See `CLAUDE.md` for the per-module breakdown.

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
