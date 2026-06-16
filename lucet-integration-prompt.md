# Lucet - Integration Goal Prompt for Claude Code

## Context

You are picking up the Lucet VS Code extension at the end of M8. All building blocks are implemented and unit-tested. The model-calling path is deliberately stubbed, held pending confirmation of Agent SDK auth behaviour. That confirmation is now in hand: Anthropic have paused the previously announced change to a separate monthly credit pool. Agent SDK usage continues to draw from the Max subscription's existing plan limits via subscription OAuth, exactly as before. There is no billing change to account for.

Read `CLAUDE.md` first. It is the authoritative briefing. The full spec is `code-lens-ai-spec.md`. Both are in the repo root.

---

## What is stubbed and must be wired

The following are listed in CLAUDE.md under "Stubs / not yet wired". Wire them in order, one at a time, confirming each acceptance check before proceeding.

### 1. Verify SDK auth and Haiku selectability

Before writing any wiring code, verify:

- `ANTHROPIC_API_KEY` is absent from the environment. If present, warn the user and refuse to continue until it is unset. The credential stripping in `analysis/env.ts` handles the spawned process, but the user must also clear it from their shell.
- Run a live `query()` call through `startAnalysisSession()` in `analysis/session.ts` with a hardcoded prompt ("Explain in one sentence: `const x = 1;`") and `allowedTools: []`.
- Confirm the response comes from the subscription OAuth path, not a pay-as-you-go account.
- Confirm `claude-haiku-4-5-20251001` is selectable on this path. If it is not, update `lucet.glanceModel` default in `package.json` to `claude-sonnet-4-6` and note it in CLAUDE.md.

**Acceptance:** The ping command returns a model response, the cost meter increments, and auth source is the subscription.

---

### 2. Wire the glance hover path

File: `src/extension.ts`, `src/ui/hover.ts` (create if absent)

Currently `provideHover` returns surrounding source context without calling the model. Replace this with a live glance call:

- After the dwell delay, select the node using `structure/parser.ts` (the AST path, not the raw line).
- Assemble glance context via `context/assembler.ts` (create if absent, or inline for now - target 500-1,500 tokens: node text + enclosing function signature + referenced names/imports).
- Compute the cache key via `cache/store.ts` `computeCacheKey()` with `depth: 'glance'`, `model: glanceModel`, `promptVersion`.
- On a cache hit: render immediately, no model call.
- On a miss: call `startAnalysisSession()` with the glance system prompt from `analysis/prompts.ts`. Collect the streamed result, store it, render it.
- Apply the highlight decoration to the selected node range (not the whole line) on resolve; clear it on dismiss.
- Cancel any in-flight call via `AbortController` on cursor move.

**Acceptance:** Hovering a symbol in a TS file shows a one or two sentence explanation within ~1.5s, and the exact AST node range is highlighted. Hovering the same unchanged node twice makes one model call (visible in the cost meter).

---

### 3. Wire the deep-dive panel

File: `src/extension.ts`, `lucet.deepDive` command

Currently the command renders the fixed section scaffold and the assembled prompt in an HTML comment, with no model call. Replace with:

- Keep the existing prompt assembly via `buildDeepDivePrompt()` and semantic grounding via `gatherSemanticFacts()` / `foldSemanticsIntoContext()`.
- Compute the cache key (`depth: 'deep'`, `model: deepDiveModel`).
- Cache hit: render immediately.
- Miss: call `startAnalysisSession()` with the deep-dive prompt. Stream the result into the panel incrementally (update `panel.webview.html` as chunks arrive, or buffer and render on completion - streaming is preferred but not required for acceptance).
- Render the five fixed section headers as collapsible `<details>` elements in the panel HTML. "Defined at" entries that resolve to a workspace file must be clickable links that call `vscode.commands.executeCommand('vscode.open', uri, { selection: range })`.

**Acceptance:** Alt-hover over a line inside a function produces the labelled deep-dive sections in the panel. A deep-dive on a call to a local function includes that function's real signature, and the "Defined at" link navigates to it.

---

### 4. Feed the cost meter and bind it to the status bar

File: `src/ui/meter.ts`, `src/extension.ts`

The `CostMeter` class is implemented and tested. What is missing:

- Create a `CostMeter` instance in `activate()`.
- After each `query()` call completes, iterate the result messages and pass any `CostBearingMessage` to `meter.record()`.
- Create a `vscode.StatusBarItem` (priority 100, left-aligned) and update its text after every `meter.record()` call: `meter.format(config.monthlyCreditUSD)`.
- Dispose the status bar item on `deactivate()`.

Note: with the credit pool change paused, there is no hard monthly cap to enforce. The meter is for personal visibility only. `lucet.monthlyCreditUSD` remains in settings as a reference figure for the display.

**Acceptance:** The status bar shows `$0.00 / $100` on first activation. After a glance it shows a non-zero spend. After `lucet.clearCache` the meter does not reset (cache and spend are independent).

---

### 5. Wire the Why tier

File: `src/extension.ts`, `src/ui/panel.ts`

Add an "Explain why" button to the deep-dive panel HTML. On click, the button sends a message to the extension host via `acquireVsCodeApi().postMessage({ type: 'explainWhy' })`. In `panel.onDidReceiveMessage`:

- Assemble why-tier context via `context/rationale.ts` `assembleWhyContext(workspaceRoot)`.
- Compute the cache key: `sha256(targetText + dependencyManifestHash + promptVersion)`.
- Cache hit: append the cached why section to the panel.
- Miss: call `startWhySession()` with `buildWhyPrompt()`. The why session uses `WHY_TOOLS` (`Read`, `Grep`, `Glob`, `Bash`), bounded by `lucet.whyRetrievalSteps`. Stream the result and append it below the deep-dive breakdown.
- Fit claims rendered in the panel must link to a real project fact. If `buildFitSection()` throws `UnreferencedFitClaimError`, surface it as a visible caveat rather than crashing the panel.

**Acceptance:** Clicking "Explain why" on a hand-rolled array grouping in a project that already depends on lodash produces a fit-here claim that references the lodash dependency; a fit claim never appears without a referent.

---

### 6. Wire the As Python view

File: `src/extension.ts`, `src/ui/panel.ts`

Add a "Show as Python" button to the panel HTML, visible only when the source language differs from `lucet.pivotLanguage`. On click, `postMessage({ type: 'showAsPython' })`:

- Cache key: `computePythonViewCacheKey({ targetText, pivotLanguage, promptVersion })`.
- Cache hit: render immediately.
- Miss: call `startAnalysisSession()` with `buildAsPythonPrompt()` and the pivot model (`lucet.pivotModel`, default `claude-sonnet-4-6`). `allowedTools: []`.
- Render the result as a Python code block with syntax highlighting (a `<pre><code class="language-python">` block is sufficient) and a copy button. Include the illustrative-only header from the prompt constraints. The "Caveats" line from the model output must be visually distinct from the code block.

**Acceptance:** Deep-diving a TypeScript `map`/`filter` chain, then clicking "Show as Python", yields a comprehension rather than a transliterated for-loop. The button is absent on Python files. The same unit renders once and caches.

---

## Hard rules - do not violate

These are copied from CLAUDE.md. They are not suggestions.

- Never run the Agent SDK with `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` set in the spawned env. `analysis/env.ts` `stripAnthropicCredentials()` must be called on every session start. Warn the user if the variable is set globally.
- Glance, deep-dive, and as-Python use `allowedTools: []`. Only the why tier gets `Read`, `Grep`, `Glob`, and restricted `Bash`. Never `Write` or `Edit` on any tier.
- All model calls go through `analysis/session.ts`. Do not call `query()` anywhere else.
- The why tier must analyse fit, not assert the author's intent. Every "fit here" claim must link to a checkable project fact. `buildFitSection()` enforces this; do not bypass it.
- The As Python view is illustrative, not a port. The header and caveats line are required, not optional.
- Grammar `.wasm` files resolve from the extension install dir, never the workspace.
- No telemetry. No network calls except the Agent SDK's own.

---

## Key files

| File | Role |
|---|---|
| `analysis/session.ts` | Only place `query()` is called. `startAnalysisSession` / `startWhySession`. |
| `analysis/env.ts` | Credential stripping. Top auth footgun lives here. |
| `analysis/prompts.ts` | All per-tier prompts + `promptVersion`. Changing a prompt = bump version. |
| `analysis/context.ts` | Surrounding-context builder (used by glance hover). |
| `context/rationale.ts` | Why-tier context: dependency manifest + hash. |
| `structure/parser.ts` | Node selection + grammar wasm loading. |
| `structure/semantics.ts` | `executeHoverProvider` / `executeDefinitionProvider` wrappers. |
| `cache/store.ts` | `CacheStore`, `computeCacheKey`, `computePythonViewCacheKey`, `getOrAnalyze`. |
| `ui/meter.ts` | `CostMeter`. Implemented and tested. |
| `ui/panel.ts` | `showDeepDivePanel`. Currently renders preformatted text only. |
| `extension.ts` | `activate()`. Commands and hover provider registered here. |

---

## Working discipline

- One step at a time. Do not proceed to the next step until the acceptance check for the current step passes.
- Review diffs to `session.ts`, `env.ts`, `prompts.ts`, and the cache keys before accepting any change to those files.
- Update CLAUDE.md before treating any step as done. An out-of-date CLAUDE.md compounds errors in subsequent sessions.
- If Haiku is confirmed selectable on the subscription path, note it in CLAUDE.md. If it is not, note the fallback model used.
