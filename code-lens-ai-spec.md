# Build Brief - Hover-Driven AI Code Explanation Layer (solo edition)

Working name: **Lucet**. A VS Code extension that explains any line or block of code on hover, with a held modifier to escalate to a deeper breakdown. Single-user tool for personal use. Backed by the author's Claude Max subscription via the Claude Agent SDK, not a paid API key.

This document is written to be handed to Claude Code as the build spec. It states the stack, the architecture, the interaction contract, ordered milestones with acceptance criteria, and the known traps. Sections marked **[BUILD]** are instructions to the implementer. Sections marked **[CONSTRAINT]** must not be violated.

Version 0.5 - solo build brief. Adds the "As Python" comprehension view (render a non-Python unit as idiomatic Python). Supersedes the earlier product-oriented draft.

---

## 1. What this is, and what it is not

A reading aid. Hover over code, get a plain-language explanation of what it does. Three depths, each an explicit escalation of the one before:

- **Glance** - hover, no modifier. One or two sentences on what the line or block does.
- **Deep dive** - hold a modifier while hovering. Structured breakdown: control flow, inputs/outputs, side effects, edge cases, and where referenced symbols are defined.
- **Why** - an "Explain why" affordance inside the deep-dive panel. Expands the explanation with why this implementation was chosen over the alternatives that would achieve the same thing: the candidate approaches, the trade-offs between them, and why the chosen one fits this project, judged against the patterns, dependencies, and conventions already in the codebase. This is analysis, not retrieval of recorded intent; it is opt-in, slower, and frames fit claims against checkable project facts (see sections 7.6 and 7.7).
- **As Python** - a "Show as Python" affordance in the deep-dive panel, shown only when the source unit is not already Python. Renders the same function or block as idiomatic Python, as a reading aid for people who parse Python fastest. Illustrative, not a port: it maps idioms rather than syntax, flags constructs that do not translate cleanly, and never claims to be runnable or behaviourally equivalent (see section 7.8). Target language is a setting, default Python.

**Out of scope (do not build):** code generation, autocomplete, refactoring, chat, multi-user support, hosted services, team caches, telemetry, marketplace publishing. This is one person's local tool. Resist gold-plating. If a feature is not in the milestones in section 9, do not add it.

---

## 2. Scope and assumptions

- Single user, single machine, VS Code (or a fork: Cursor, VSCodium).
- The user holds a Claude Max subscription. Model usage is drawn from the subscription's Agent SDK credit, billed at API rates against that credit (see section 5).
- Languages for v1: TypeScript/JavaScript and Python. Architecture must not hardcode these two; adding a language should be adding a grammar and nothing else.
- Local only. No code leaves the machine except through the Agent SDK's own call to Anthropic, which is the same path Claude Code already uses.

---

## 3. Interaction contract

Three input primitives, all native to VS Code: hover position, text selection, held modifier key.

| Trigger | Unit explained | Output | Model tier |
|---|---|---|---|
| Hover, no modifier | Smallest meaningful AST node enclosing the cursor | Glance: 1 - 2 sentences | Fast |
| Hover + held modifier | Enclosing function/class of that node | Deep dive: structured | Capable |
| Selection present, hover it | The exact selection, snapped to node boundaries | Glance or deep dive per modifier | Follows modifier |
| "Explain why" click in deep-dive panel | Same unit, compared against project patterns | Why: alternatives, trade-offs, fit-to-project with cited code | Capable, with retrieval tools |
| "Show as Python" click (non-Python source) | Same unit, reusing deep-dive context | Idiomatic Python rendering + caveats for lossy mappings | Mid, no tools |

Rules **[CONSTRAINT]**:

- Configurable hover dwell delay, default 400ms. Nothing fires before it elapses.
- The explained range is highlighted with a `TextEditorDecorationType` the moment the result resolves, so the scope being explained is never ambiguous. This is the one piece of UX that must not be cut.
- The modifier is held, not toggled. Release reverts to glance behaviour and dismisses the deep-dive panel.
- No background scanning. Requests fire only on an intentional hover or selection.

Default modifier: `Alt`/`Option`. **[BUILD]** Check for conflicts with multi-cursor bindings per platform and make it a setting.

---

## 4. Stack and libraries

Lean on existing libraries. Do not write what these already do.

| Concern | Use | Notes |
|---|---|---|
| Model calls on subscription | `@anthropic-ai/claude-agent-sdk` (TypeScript) | Wraps the bundled Claude Code binary. Primary call is `query({ prompt, options })`, an async generator of messages. Proprietary licence; fine for personal use. |
| Syntax parsing / node selection | `web-tree-sitter` (WASM) + grammar wasm (`tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python`) | Runs in the extension host. Portable, no native build step. Error-tolerant and fast enough for per-hover use. |
| Semantic info (types, definitions) | VS Code's own providers, not a custom LSP client | Call `vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position)` and `'vscode.executeDefinitionProvider'`. This reuses whatever language servers the user already has installed. Do not build or bundle an LSP client. |
| Result cache | Node `crypto` for hashing + `context.globalStorageUri` (JSON on disk) | No dependency needed. |
| Deep-dive panel | VS Code `WebviewPanel`, plain HTML/CSS/JS | Keep dependency-free. No React unless a milestone needs it. |
| Extension scaffold | `yo code` (generator-code), TypeScript template | Standard VS Code extension layout. |

Runtime: Node 20+ (the Agent SDK / Claude Code binary needs a recent Node).

---

## 5. Auth and billing model (read carefully - this is where it goes wrong)

The Agent SDK authenticates by a precedence chain. For subscription use the OAuth path must win, which means the API-key paths must be absent.

**[CONSTRAINT]** The extension must not run the Agent SDK with `ANTHROPIC_API_KEY` set in the spawned process environment. If that variable is present it silently overrides the subscription OAuth token, and usage is billed to a pay-as-you-go API account instead of the Max plan. The extension must strip `ANTHROPIC_API_KEY` (and `ANTHROPIC_AUTH_TOKEN`) from the environment it passes to the SDK, and surface a visible warning if it detects one set globally.

**[BUILD]** Setup steps the extension documents to the user on first run:

1. Install Claude Code: `npm install -g @anthropic-ai/claude-code`.
2. Authenticate against the subscription: `claude setup-token` (browser flow, returns a long-lived token), or interactive `claude` login choosing "log in with your subscription account".
3. Confirm no `ANTHROPIC_API_KEY` is exported in the shell or VS Code's environment.

Billing reality to reflect in the UI:

- From 15 June 2026, programmatic Agent SDK usage draws from a separate monthly credit, not the interactive chat pool. Roughly $100/month for Max 5x, $200 for Max 20x, billed at API rates, non-rollover. When it is exhausted, calls stop unless overflow billing is enabled.
- **[BUILD]** Each Agent SDK result message exposes usage and a `costUSD` estimate (plus cache token counts). Accumulate this and show a status-bar meter of month-to-date spend against the credit, so the user sees how close they are to the cap. Reset the counter monthly. Treat `costUSD` as an estimate, not a bill.

This subscription path is for the author's own use only. Do not add any feature that would let another person's subscription power the tool; that is disallowed and out of scope anyway.

---

## 6. Architecture

Everything runs in the extension host. There is no server.

```
  VS Code extension host
  ┌─────────────────────────────────────────────┐
  │ Hover/selection + modifier  →  request           │
  │            │                                       │
  │            ▼                                       │
  │ Structure layer                                    │
  │   web-tree-sitter (node selection)                 │
  │   + executeHoverProvider / executeDefinitionProvider│
  │            │  node + scope + symbol facts           │
  │            ▼                                       │
  │ Context assembler  →  cache key (content hash)      │
  │            │  cache miss                            │
  │            ▼                                       │
  │ Analysis: claude-agent-sdk query()                  │
  │   persistent session · allowedTools: [] · model per │
  │   depth · OAuth/subscription auth                   │
  │            │                                       │
  │            ▼                                       │
  │ Result cache (globalStorage JSON)                   │
  │            │                                       │
  │            ▼                                       │
  │ Render: hover tooltip (glance) / WebviewPanel (deep)│
  │ + highlight decoration                              │
  └─────────────────────────────────────────────┘
```

---

## 7. Component detail

### 7.1 Structure layer

Turns a cursor position into the right unit to explain plus the facts the model needs.

- Parse the document with `web-tree-sitter`. On hover, walk from the cursor's position to the smallest named node that is a complete statement or expression. On deep dive, walk up to the enclosing function or class.
- For semantic facts, query VS Code's existing providers: `executeHoverProvider` for type info at referenced symbols, `executeDefinitionProvider` to resolve where they are defined. Use these to ground the deep dive instead of letting the model infer types.
- Output: target node text and kind, enclosing scope text, resolved symbol facts where available, and the byte/character range to highlight.

**[BUILD]** Re-parse incrementally on document change; do not re-parse the whole file on every hover.

### 7.2 Context assembler

Builds the minimal context per depth and a deterministic cache key.

- Glance context: target node + enclosing function signature + names/imports it references. Target 500 - 1,500 tokens.
- Deep-dive context: target node + full enclosing function + definitions of referenced symbols (from `executeDefinitionProvider`) + relevant docstrings. Target 4,000 - 10,000 tokens.
- Cache key: `sha256(targetText + assembledContext + promptVersion + model + depth)`. Identical inputs never hit the model twice.

### 7.3 Analysis layer (Agent SDK)

- One persistent Agent SDK session reused across hovers, not a cold `query()` per hover. Cold-starting the CLI per request adds latency that kills the hover feel. Keep a warm session; cancel in-flight work on cursor move via `AbortController`.
- **Tool access is tiered [CONSTRAINT]:**
  - Glance and deep-dive: `allowedTools: []`. These answer only from the context you assemble. No tools means no wandering, low latency, predictable behaviour. This is the common path and must stay fast.
  - Why tier only: a constrained, read-only tool set - `Read`, `Grep`, `Glob`, and `git` through a restricted `Bash` (blame, log, show). Never `Write` or `Edit`. The why tier is opt-in and slower, so agentic retrieval latency is acceptable there. The tool allow-list is the permission boundary; anything not listed is not available to the model.
- System prompt per depth, constrained hard. Glance: max two sentences, no preamble, plain language. Deep dive: fixed labelled sections (What it does / Inputs and outputs / Side effects / Edge cases / Defined at). Why: see 7.6. The failure mode is padding; constrain against it.
- Model per depth, set via `options.model`:
  - Glance: `claude-haiku-4-5-20251001` for speed and to spare the credit. **[BUILD]** Verify Haiku is selectable on the subscription/OAuth path; if it is not exposed there, fall back to `claude-sonnet-4-6` for glance.
  - Deep dive and why: `claude-opus-4-8`.
- Put the stable context (file-level, imports, project memory) at the front of the prompt so prompt caching applies; per-hover variable content after it.

### 7.4 Result cache

- JSON file in `context.globalStorageUri`, keyed by the hash from 7.2.
- Cache hit renders immediately, no model call.
- Invalidated naturally when code or prompt version changes (both are in the key). Provide a "clear explanation cache" command.

### 7.5 UI

- Glance renders in the native hover tooltip (markdown). Show a spinner within the dwell window; if a glance exceeds ~1.5s it is mis-routed.
- Deep dive renders in a `WebviewPanel` with collapsible sections and clickable "Defined at" links that jump the editor to the definition. The panel carries an "Explain why" button that triggers the why tier and appends the result below the breakdown.
- Why results render as: a short list of candidate approaches, the trade-offs between them, and a "fit here" section whose claims carry links to the sibling code, dependency, or convention they rest on. Where a recorded reason exists (commit, PR, comment) it is shown as corroboration with its source. Analytical claims and any recorded-intent claims are visually distinct.
- The panel also carries a "Show as Python" button when the source is not Python. Its result renders as a Python code block with syntax highlighting and a copy button, followed by a short "caveats" line listing any constructs that did not map cleanly. A header makes clear the Python is illustrative, not a runnable port.
- Apply the highlight decoration on resolve; clear it on dismiss or cursor move.

### 7.6 Why tier behaviour

Answers "why this implementation, and not the alternatives that would do the same job, in this project". This is comparative analysis grounded in the codebase, not retrieval of recorded intent. Recorded intent, where it exists, is a bonus, not the basis.

- Output shape, in order:
  - **Approaches.** The chosen implementation plus 2 - 4 other plausible ways to achieve the same function/feature. The model generates these from the code itself; no retrieval needed.
  - **Trade-offs.** The axes that separate them here - performance, readability, dependency cost, error handling, consistency with surrounding code, type safety - kept concrete, not generic.
  - **Fit here.** Why the chosen approach suits this project, each claim tied to a checkable project fact: a sibling implementation, an existing dependency, a lint/tsconfig setting, a stated convention. These carry links.
  - **Recorded reason (optional).** If a commit message, PR, or code comment states an actual reason, surface it with its source. Omit the section if none is found.
- **[CONSTRAINT]** Default voice is analytical: "why this fits / what the trade-offs are", not "the author chose this because X". Deliberate intent is only asserted when a recorded source is cited. The tool must not present its own reasoning as a statement of the author's intent. Presenting analysis as fact about someone's decision is this tier's worst failure.
- **[CONSTRAINT]** Every "fit here" claim points at a project fact the user can open. A fit claim with no referent is not allowed; if the model cannot tie a preference to something in the project, it states the trade-off generically instead of claiming this project prefers it.
- If the code is trivial or the alternatives are not materially different, say so briefly rather than manufacturing a comparison.

### 7.7 Context model for the why tier (efficiency design)

What makes the answer project-specific is the live codebase, not its history. Generating the alternatives needs no context; judging fit needs a calibrated sample of how this project already works. Assemble cheapest-first, on click only, and cache.

Layers, in order:

1. **The code and its alternatives (free).** The target unit plus its deep-dive context is enough for the model to enumerate candidate approaches and their general trade-offs. No retrieval.
2. **Project convention sample (the part that matters).** Targeted `Grep`/`Read` for: sibling implementations of the same pattern or API (how does this project usually do this?), the dependency manifest (`package.json`, `pyproject.toml` - because "hand-roll vs use a library" turns on what is already a dependency), and strictness settings (`tsconfig`, lint config). This is what turns generic trade-offs into "fits this project". Bound it with a step limit.
3. **Project memory file (cached base).** `CLAUDE.md` via `settingSources: ['project']`, in the cacheable prefix, for stated values and constraints. Near-free to include once cached.
4. **Recorded intent (optional corroboration).** `git blame` the range, read the introducing commit/PR, scan nearby comments. Only to corroborate, not to drive. Cheap and targeted, so run it, but the answer does not depend on it.

Efficiency and memory:

- **Opt-in only.** None of this runs until "Explain why" is clicked. The cheap tiers never carry it.
- **Cache** keyed by `sha256(targetText + dependencyManifestHash + promptVersion)`. Fit depends on project state, so include a coarse project fingerprint, not just the code. Accept mild staleness; offer a manual "re-analyse" on the panel.
- **No write-back here.** The earlier write-back idea fit recorded-decision capture, which is no longer the point. Dropped. If a "pin this analysis as a note" affordance is ever wanted, treat it as separate future work.

**[BUILD]** No embedding/vector index in v1; use `Grep`/`Read`. Note clearly, though, that this tier is the strongest case for one later: "find sibling implementations of this pattern across the project" is a semantic-similarity task that grep only approximates. The upgrade path is a local code-embedding index feeding layer 2; do not build it now.

### 7.8 As Python view behaviour

Renders the deep-dive unit as idiomatic Python, for readers who parse Python fastest. A comprehension aid, not a migration tool.

- Shown only when the source language is not the target (default Python). Hidden on Python sources. Target language is `lucet.pivotLanguage`, default `python`.
- Unit is the deep-dive unit (enclosing function/block), never a lone line.
- Context reuses the deep-dive context already assembled (unit + referenced type definitions from M4). No project sampling, no retrieval, `allowedTools: []`. This makes it the cheapest of the deep tiers.
- Model: `claude-sonnet-4-6` by default (bounded task, spares the credit), configurable via `lucet.pivotModel`. Fall back to `claude-opus-4-8` only if Sonnet output is weak on hard-to-map constructs.
- **[CONSTRAINT]** Idiomatic, not transliterated. Map idioms to their Python equivalents (collection pipelines to comprehensions, pattern matching to `match`, etc.). Do not mirror the source syntax token for token.
- **[CONSTRAINT]** Flag lossy or divergent mappings. Where the source uses something Python lacks or expresses differently - concurrency primitives (goroutines, channels), ownership/borrowing, pointer semantics, async timing, structural vs nominal typing - the Python approximates it and a caveat says so. The output must not be presented as runnable or behaviourally equivalent; label it illustrative.
- If a unit does not translate meaningfully (a shader, SQL, inline assembly, heavy macro use), say that plainly instead of forcing a rendering.
- Cache keyed by `sha256(targetText + pivotLanguage + promptVersion)`.

---

## 8. Repository structure

```
lucet/
  package.json            # extension manifest: commands, keybindings, settings, activation
  tsconfig.json
  CLAUDE.md               # conventions for the implementer (see section 12)
  src/
    extension.ts          # activate(): register hover provider, commands, keybindings
    structure/
      parser.ts           # web-tree-sitter init + node selection
      semantics.ts        # wrappers over executeHoverProvider / executeDefinitionProvider
    context/
      assembler.ts        # build context + cache key per depth
      rationale.ts        # why-tier context: convention sampling (grep siblings, deps, lint), CLAUDE.md, optional git corroboration
    analysis/
      session.ts          # persistent Agent SDK session, query routing, abort handling
      prompts.ts          # glance / deep-dive / why / as-python system prompts, promptVersion constant
      env.ts              # strip ANTHROPIC_API_KEY/AUTH_TOKEN, detect+warn
    cache/
      store.ts            # globalStorage JSON cache (results + rationale + python views)
    ui/
      hover.ts            # glance tooltip provider
      panel.ts            # deep-dive webview + "Explain why" + "Show as Python" + source-cited claims
      decoration.ts       # highlight decoration type + apply/clear
      meter.ts            # status-bar cost meter
    grammars/             # *.wasm grammar files
  test/
```

---

## 9. Build milestones

Build in order. Each milestone has an acceptance check the implementer can run before moving on.

**M0 - Scaffold and auth.** Generate the extension with `yo code` (TypeScript). Add the Agent SDK. Implement `analysis/env.ts` and `analysis/session.ts`: a warm session that answers a hardcoded prompt via `query()` with `allowedTools: []`.
*Accept:* running an "explain: ping" command returns a model response, and the cost meter increments. Confirm via the SDK's account info that auth source is the subscription, not an API key.

**M1 - Glance on hover, no AST yet.** Register a `HoverProvider`. On hover after the dwell delay, send the current line plus a few lines of surrounding context to the glance model. Render the result in the tooltip. Apply a highlight to the line.
*Accept:* hovering a line in a TS file shows a one or two sentence explanation within ~1.5s, and the line is highlighted while the tooltip is open.

**M2 - Tree-sitter node selection.** Add `web-tree-sitter`, load TS/JS and Python grammars. Replace "current line" with "smallest enclosing node". Highlight the node's exact range.
*Accept:* hovering inside a call expression explains and highlights the whole expression, not the raw line.

**M3 - Deep dive on held modifier.** Detect the held modifier (keybinding + `when` context). On modifier-hover, widen the unit to the enclosing function, build deep-dive context, route to Opus, render the structured breakdown in a webview.
*Accept:* Alt-hover over a line inside a function produces the labelled deep-dive sections in a panel; releasing Alt dismisses it.

**M4 - Semantic grounding.** Use `executeDefinitionProvider`/`executeHoverProvider` to pull resolved types and definition locations into the deep-dive context, and make "Defined at" links jump the editor.
*Accept:* a deep dive on a call to a local function includes that function's real signature, and the "Defined at" link navigates to it.

**M5 - Result cache.** Add the content-hash cache. Glance and deep-dive results persist across sessions. Add a clear-cache command.
*Accept:* hovering the same unchanged node twice makes one model call (visible in the meter); editing the node forces a fresh call.

**M6 - Cost meter and polish.** Status-bar month-to-date spend against the credit, dwell-delay setting, modifier-key setting, language toggle.
*Accept:* the meter tracks cumulative `costUSD` and resets monthly; settings take effect without reload where feasible.

**M7 - Why tier (comparative analysis).** Add the "Explain why" button to the deep-dive panel. Implement `context/rationale.ts`: sample project conventions via `Grep`/`Read` (sibling implementations of the same pattern/API, dependency manifest, lint/tsconfig), load `CLAUDE.md` via `settingSources: ['project']`, and optionally `git blame` the range for corroboration. Route to a why session with the read-only tool set (`Read`, `Grep`, `Glob`, restricted `Bash`), bounded by `lucet.whyRetrievalSteps`. Render approaches, trade-offs, and a fit-here section whose claims link to the cited project facts. Cache keyed by content + dependency-manifest hash.
*Accept:* clicking "Explain why" on, say, a hand-rolled array grouping in a project that already depends on lodash produces a fit-here claim that references the existing lodash dependency with a link; a fit claim never appears without a referent; the default wording analyses fit rather than asserting the author's intent; recorded intent, when present in the introducing commit, appears as a separate cited corroboration.

*(Earlier drafts had an M8 memory write-back. It fit recorded-decision capture, which is no longer the point of this tier, so it is dropped. A "pin this analysis" affordance, if ever wanted, is separate future work.)*

**M8 - As Python view.** Add the "Show as Python" button to the deep-dive panel, visible only when the source language differs from `lucet.pivotLanguage`. Reuse the deep-dive context; route to the pivot model with `allowedTools: []`. Render the Python in a highlighted, copyable code block with an illustrative-only header and a caveats line for lossy mappings. Cache keyed by content + pivot language.
*Accept:* deep-diving a TypeScript function that maps and filters an array, then clicking "Show as Python", yields idiomatic Python using a comprehension rather than a transliterated for-loop; a unit using a construct Python lacks produces a named caveat; the button is absent on Python files; the same unit renders once and caches.

---

## 10. Commands, keybindings, settings (manifest contract)

Commands: `lucet.explainSelection`, `lucet.explainWhy`, `lucet.showAsPython`, `lucet.toggleHoverExplain`, `lucet.clearCache`, `lucet.showSetup`.
Keybindings: hold modifier (default `Alt`) for deep dive while hovering.
Settings: `lucet.dwellMs` (default 400), `lucet.modifier` (default `alt`), `lucet.glanceModel`, `lucet.deepDiveModel`, `lucet.languages` (default `["typescript","javascript","python"]`), `lucet.monthlyCreditUSD` (for the meter), `lucet.whyRetrievalSteps` (default 6), `lucet.pivotLanguage` (default `python`), `lucet.pivotModel` (default `claude-sonnet-4-6`).

---

## 11. Known traps

- **`ANTHROPIC_API_KEY` shadowing the subscription.** The single biggest mistake. Strip it from the SDK's environment and warn if set. (Section 5.)
- **Cold-starting the SDK per hover.** Too slow. Keep a warm session. (Section 7.3.)
- **Letting the fast tiers use tools.** Glance and deep-dive run `allowedTools: []`. Only the opt-in why tier gets the read-only set (`Read`, `Grep`, `Glob`, restricted `Bash`), never `Write`/`Edit`. (Section 7.3.)
- **Asserting intent.** The why tier analyses why an approach fits; it must not state why the author chose it unless a recorded source is cited. Every "fit here" claim must link to a real project fact (sibling code, dependency, config), never stand on assertion. (Section 7.6.)
- **Python view passed off as a port.** The "As Python" rendering is illustrative. Map idioms not syntax, name every construct that does not translate cleanly, and never imply it is runnable or equivalent. (Section 7.8.)
- **Runaway why queries.** Bound the agentic retrieval with a step limit (`lucet.whyRetrievalSteps`) so one expansion cannot grep the whole repo.
- **tree-sitter WASM loading.** Grammar `.wasm` files must be bundled and their path resolved relative to the extension install dir, not the workspace.
- **Bundled CLI binary resolution.** The SDK ships the Claude Code binary as an optional platform dependency. If the package manager skips optional deps, the SDK errors; install with optional deps enabled, or set `pathToClaudeCodeExecutable` to a separately installed `claude`.
- **Re-parsing whole files on every hover.** Parse incrementally.
- **Confidently-wrong explanations.** Ground the deep dive in the language server's resolved facts rather than model inference; show a low-confidence marker when semantic data was unavailable.

---

## 12. Suggested CLAUDE.md for the build

Put this in the repo root so the implementer keeps to the brief:

```
# Lucet - build conventions

This is a solo VS Code extension that explains code on hover using the
Claude Agent SDK against the author's Max subscription. It is NOT a product.

Hard rules:
- Never run the Agent SDK with ANTHROPIC_API_KEY set in its environment.
  Strip it. Subscription OAuth auth must win. (See spec section 5.)
- Tool access is tiered. Glance and deep-dive: allowedTools: []. The why tier
  only: Read, Grep, Glob, and git via restricted Bash. Never Write or Edit.
- The why tier is comparative analysis: alternatives, trade-offs, and why this
  fits the project. Analyse fit; do not assert the author's intent unless a
  recorded source (commit/PR/comment) is cited. Every "fit here" claim links
  to a real project fact. No referent, no claim.
- The As Python view is illustrative: idiomatic Python, not transliteration,
  with caveats for constructs that do not map. Never imply it is runnable or
  equivalent. Hidden when the source is already the pivot language.
- Keep one warm Agent SDK session; never cold-start per hover.
- No embedding/vector index in v1. Use grep/read over the project + cached
  CLAUDE.md. Embeddings are the noted upgrade path for the why tier only.
- No telemetry, no network calls except the SDK's own.
- Do not add features outside the milestones. No autocomplete, no chat,
  no generation, no multi-user anything.

Stack: TypeScript, @anthropic-ai/claude-agent-sdk, web-tree-sitter,
VS Code provider commands for semantics. Node 20+.

Build milestones in order M0-M8; each has an acceptance check in the spec.
Stop at each acceptance check and verify before continuing.
```

---

*Product and pricing facts (Agent SDK package name and behaviour, subscription credit from 15 June 2026, auth precedence, model identifiers) reflect Anthropic's published information as of 12 June 2026 and should be re-checked at build time, since this area has changed repeatedly in recent months. Verify Haiku selectability on the subscription path during M1.*
