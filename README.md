# Lucet

A VS Code extension that adds code-explaining features, built on the Claude Agent SDK.

Lucet explains any line or block of code on hover, backed by the author's Claude Max
subscription. It is a personal, single-user reading aid — not a product. The full build
brief is in [`code-lens-ai-spec.md`](./code-lens-ai-spec.md); contributor conventions are
in [`CLAUDE.md`](./CLAUDE.md).

## Status

The model-calling path is now **wired end-to-end** and verified live against the
Max subscription (16 June 2026): glance, deep dive, why, and the As-Python view all
run through the warm Agent SDK session, are content-hash cached, and feed the cost
meter. Tool tiers are enforced (glance / deep-dive / as-Python use `allowedTools: []`;
only why gets `Read`/`Grep`/`Glob`/`Bash`).

> **Billing note:** the previously-announced 15 June 2026 move to a separate monthly
> Agent SDK credit pool was **paused** by Anthropic. SDK usage continues to draw from
> the Max subscription's existing plan limits via subscription OAuth, as before, so
> there is no billing change to account for. `lucet.monthlyCreditUSD` is a personal
> visibility figure for the status-bar meter, not a hard cap.

**Still needs interactive (F5) verification.** The logic is unit-tested and the model
paths are verified headlessly, but the VS Code UI surfaces have not been exercised in a
running Extension Development Host: the glance tooltip + dwell + node highlight, the
deep-dive webview (collapsible sections, "Defined at" navigation, the Explain-why /
Show-as-Python buttons, copy), and the status-bar item. See `CLAUDE.md` for details and
known follow-ups (best-effort glance cancellation; prompt-level vs structured why-claim
enforcement).

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
