# Lucet - Claude Code Guide

Lucet is a single-user VS Code extension that explains code on hover, backed by the
author's Claude Max subscription through the Claude Agent SDK. It is a personal tool,
not a product. The full spec is `code-lens-ai-spec.md`; this file is the always-loaded
briefing. Keep it under ~120 lines. Update it at the end of every module.

## Architecture
Single VS Code extension. TypeScript, Node 20+. No server, no database, no multi-user
anything. Everything runs in the extension host.

```
src/
  extension.ts     activate(): registers hover provider, commands, keybindings
  structure/       parser.ts  - web-tree-sitter node selection
                   semantics.ts - VS Code executeHoverProvider / executeDefinitionProvider
  context/         assembler.ts - per-depth context + cache key
                   rationale.ts - why-tier convention sampling
  analysis/        session.ts - the one warm Agent SDK session
                   prompts.ts - per-tier system prompts + promptVersion
                   env.ts     - credential stripping
  cache/           store.ts   - globalStorage JSON cache
  ui/              hover.ts, panel.ts, decoration.ts, meter.ts
  grammars/        *.wasm tree-sitter grammars
```

## The four explanation tiers
- Glance - hover, no modifier. Smallest enclosing AST node. claude-haiku-4-5 (sonnet fallback). allowedTools: [].
- Deep dive - held modifier (default Alt). Enclosing function. claude-opus-4-8. allowedTools: [].
- Why - panel button. Comparative analysis: alternatives, trade-offs, fit-to-project. Read-only tools.
- As Python - panel button, non-Python source only. Idiomatic Python rendering. claude-sonnet-4-6. allowedTools: [].

## Key design decisions (do not change without discussion)
- One warm Agent SDK session, reused across hovers. Never cold-start query() per hover.
- All model calls go through analysis/session.ts. Never instantiate query() anywhere else.
- Semantics come from VS Code's own providers. Do not build or bundle an LSP client.
- No embedding/vector index in v1. Why-tier convention sampling is grep/read only.
- Grammar wasm paths resolve relative to the extension install dir, never the workspace.

## Hard rules - never violate these
- Auth: never run the Agent SDK with ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set in its
  spawned env. Strip them in analysis/env.ts and warn if set globally. Subscription OAuth
  must win, or usage bills a pay-as-you-go account instead of the Max plan.
- Tools: glance, deep-dive, and as-Python run allowedTools: []. Only the why tier gets
  Read, Grep, Glob, and git via a restricted Bash. Never Write or Edit, on any tier.
- Honesty (why): analyse why an approach fits; never state the author's intent without a
  cited source. Every "fit here" claim links to a real project fact. No referent, no claim.
- Honesty (as Python): idiomatic, caveated, illustrative. Never imply it is runnable or
  behaviourally equivalent.
- Bounds: the why tier is capped by lucet.whyRetrievalSteps so one expansion cannot crawl the repo.
- Privacy: no telemetry, no network calls except the Agent SDK's own.
- Scope: build only what the spec's milestones (M0-M8) define. No autocomplete, chat,
  code generation, or multi-user features.

## Running locally
```
npm install
npm run watch        # compile in watch mode
# press F5 to launch the Extension Development Host
```
One-time setup: npm i -g @anthropic-ai/claude-code; claude setup-token; confirm
ANTHROPIC_API_KEY is unset in the shell and in VS Code's environment.

## Files that matter
- analysis/session.ts  - the only place query() is called
- analysis/env.ts      - credential stripping; the top auth footgun lives here
- analysis/prompts.ts  - per-tier system prompts + promptVersion (part of every cache key)
- context/rationale.ts - why-tier convention sampling (siblings, deps, lint/tsconfig)
- structure/parser.ts  - node selection and grammar wasm loading

## Cache keys (changing a prompt must bump promptVersion)
- Glance / deep dive: sha256(targetText + assembledContext + promptVersion + model + depth)
- Why:                sha256(targetText + dependencyManifestHash + promptVersion)
- As Python:          sha256(targetText + pivotLanguage + promptVersion)

## Module status
(update at the end of every module)
- Next: end-to-end wiring of the model-calling path once the 15 Jun 2026 SDK
  credit/auth changes are confirmed (see "Stubs / not yet wired" below).
- Done: structure/parser.ts node selection + grammar wasm from the extension dir
  (web-tree-sitter 0.22.6 + tree-sitter-wasms in grammars/). M3: analysis/prompts.ts deep-dive
  builder (five fixed section headers) + promptVersion, ui/panel.ts WebviewPanel, lucet.deepDive
  command + held-modifier keybinding (lucet.modifier, when-context). M4: structure/semantics.ts
  wraps executeHoverProvider/executeDefinitionProvider (injectable exec), folds resolved
  definitions into the deep-dive context, sets a low-confidence flag when empty; deepDive command
  grounds its prompt via semantics. M5: cache/store.ts content-hash key
  (sha256(targetText+context+promptVersion+model+depth)) + JSON store under globalStorage +
  getOrAnalyze (hit skips query()); lucet.clearCache registered. M6: ui/meter.ts CostMeter
  accumulates total_cost_usd/costUSD and resets on month change (injectable clock); all spec
  section 10 settings declared in package.json (lucet.languages default now includes python).
  M7: context/rationale.ts surfaces dependency manifest (lodash fixture) + manifest hash;
  analysis/session.ts whySessionOptions/startWhySession (Read/Grep/Glob/Bash); prompts.ts
  buildWhyPrompt + buildFitSection rejecting referent-less fit claims. M8: prompts.ts
  shouldShowAsPython + buildAsPythonPrompt; cache/store.ts computePythonViewCacheKey (includes
  pivotLanguage). env.ts and the glance hover path untouched.

## Billing/auth status (resolved 16 Jun 2026)
The previously-announced 15 Jun 2026 move to a separate monthly Agent SDK credit
pool has been PAUSED by Anthropic. Agent SDK usage continues to draw from the Max
subscription's existing plan limits via subscription OAuth, as before. No billing
change to account for; lucet.monthlyCreditUSD is a personal-visibility reference
figure only, not a hard cap.

Verified live (16 Jun 2026): startAnalysisSession() returns a model response with
apiKeySource: none (subscription OAuth, not a pay-as-you-go key); total_cost_usd
is populated; claude-haiku-4-5-20251001 IS selectable on this path, so the
lucet.glanceModel default stays Haiku (no Sonnet fallback needed).

## Integration wiring progress (all model paths verified live 16 Jun 2026)
- Step 1 (auth + Haiku): DONE, verified live.
- Step 2 (glance hover): DONE. ui/hover.ts selects the AST node (structure/parser),
  assembles glance context (context/assembler.ts), checks the cache, and on a miss
  calls startAnalysisSession(glanceModel) → collectResult → meter. Highlights the
  node range; cleared on selection change.
- Step 3 (deep-dive panel): DONE. lucet.deepDive selects the enclosing function,
  grounds via semantics, calls startAnalysisSession(deepDiveModel); ui/panel.ts renders
  the five sections as <details> with clickable "Defined at" links (vscode.open).
- Step 4 (meter→status bar): DONE. analysis/collect.ts feeds every result message to
  CostMeter; a StatusBarItem shows meter.format(monthlyCreditUSD). clearCache does NOT
  reset the meter.
- Step 5 (why): DONE. "Explain why" button → startWhySession (WHY_TOOLS, maxTurns =
  whyRetrievalSteps); cache key = computeWhyCacheKey(target + manifest hash + version).
- Step 6 (as-Python): DONE. Button hidden when source == pivotLanguage; calls
  startAnalysisSession(pivotModel) with buildAsPythonPrompt; key = computePythonViewCacheKey.

Live verification (scripts/verify-*.mjs): glance via Haiku; deep-dive emits 5/5 section
headers (Opus); as-Python yields a comprehension (Sonnet); why session runs with tools
(bounded). All through analysis/session.ts; allowedTools tiers intact.

## Needs interactive verification (F5 Extension Development Host)
Logic is unit-tested and model paths verified headlessly, but the VS Code UI surfaces
have not been exercised live: glance tooltip rendering + dwell timing + node highlight;
the deep-dive webview (collapsible sections, Defined-at navigation, Explain-why / Show-as-
Python buttons, copy); and the status-bar item appearance. Confirm these with F5.

## Known follow-ups
- Why-tier fit claims: the prompt enforces "no referent → no claim"; buildFitSection()
  enforces it for structured rendering, but panel currently renders the model's free
  text, so enforcement is by prompt, not by parsing. Tighten if structured why output
  is added.
- Glance cancellation is best-effort (checks the CancellationToken); no AbortController
  wired into the in-flight query yet.

## Working discipline
- One module per session. Stop at each module's acceptance criteria and verify before continuing.
- Confirm the moving parts rather than assuming them: auth source at M0, Haiku selectability at M1.
- Review diffs to shared files (session.ts, env.ts, prompts.ts, the cache keys) before accepting.
- Update this file before treating a module as done. An out-of-date CLAUDE.md compounds errors.
