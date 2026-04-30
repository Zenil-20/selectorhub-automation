# Anchor — Grounded Test Authoring

A Chrome extension + Node backend for QA engineering teams. Pick a DOM
element, get a stable Playwright/Cypress/Selenium locator. Record a flow,
get a runnable test. Connect a Claude key, get **grounded** AI assertion and
edge-case suggestions — every locator the model returns is one your engine
has already verified-unique on the live page. The model can never invent a
selector, by construction.

## Why "grounded"

Every other AI-test tool fails the same way: the LLM hallucinates a
selector, the test silently passes locally because nothing matches, then
explodes in CI. Anchor flips the dependency: the LLM is given a corpus of
locators verified-unique on a real DOM and is **forbidden** from emitting
anything outside that corpus. Post-validation rejects out-of-corpus
references; on rejection the model is asked once more with the failure
reason, then we surface the failure to the user instead of degrading.

## Repository layout

```
extension/                       Manifest V3 Chrome extension (no build step)
  src/
    core/                        Pure locator engine — framework-free, testable
      css-escape.js / aria.js / css-selector.js / xpath.js
      strategies.js / scoring.js / codegen.js / assertions.js / locator-engine.js
    content/                     Runs in page context
      highlighter.js  picker.js  recorder.js  index.js  overlay.css
    background/
      service-worker.js          Routes messages, owns local history, syncs to backend
    popup/                       Popup UI: Pick / Record / Action picker / AI panel
    options/                     Settings page (server URL + project API key)

server/                          Node + Express + node:sqlite backend
  src/
    config.js  db.js  logger.js
    services/                    captures · projects · audit · suggest · routes-pattern
    llm/                         provider · anthropic · mock · schemas · prompts · validate · ledger · pricing
    routes/                      health · captures · suggest · audit
    middleware/                  project-auth · error
    cli/create-project.js
  tests/                         28 tests across captures · suggest · ledger · validate · routes

tests/                           Extension core engine tests (jsdom-based, 18 tests)
```

## Architecture in one paragraph

The core locator engine lives in `extension/src/core/` and is **pure**: it
takes an `Element` + a `Document` and returns a ranked list of candidates.
Every candidate is run through `document.querySelectorAll` (or
`document.evaluate` for XPath) and discarded unless it resolves to exactly
one element. Text-shaped strategies (`getByText`, `getByLabel`,
`getByRole({name})`, `getByPlaceholder`, `getByTitle`, `getByAltText`) are
emitted with `{ exact: true }` so Playwright's runtime semantics match the
engine's exact-match verification — no false uniqueness.

The backend stores every capture in SQLite, scoped to a project. The
suggest endpoint loads the project's recent captures for the current route
pattern as the LLM's grounding corpus, calls Claude with a tool-use schema
that forces structured output, then runs every `locatorRef` in the model's
reply against the corpus. Hallucinations are rejected on a single retry
loop; a second hallucination surfaces a 502 with the validation errors.

## Locator priority (heuristic, no LLM needed)

1. `data-testid` / `data-test` / `data-cy` / `data-qa`  → `getByTestId`
2. ARIA `role` + accessible name                        → `getByRole({ exact: true })`
3. Associated `<label>`                                 → `getByLabel({ exact: true })`
4. `placeholder`                                        → `getByPlaceholder({ exact: true })`
5. `alt` (images)                                       → `getByAltText({ exact: true })`
6. `title`                                              → `getByTitle({ exact: true })`
7. Visible text on text-bearing elements                → `getByText({ exact: true })`
8. Stable `id` (filters Radix / `useId` / hex tails)    → `locator('#id')`
9. Scoped CSS selector (minimum-unique walk)            → `locator(css)`
10. Indexed XPath (last resort)                         → `locator('xpath=...')`

## Recorder

Click **Record** in the popup → enter the start URL → the extension
navigates the active tab and arms the recorder. Captures click / dblclick /
fill / select / check / uncheck / press, deduplicates per-keystroke fills
to a single `fill()`, survives full-page and SPA navigation. Click the
on-page **eye** to enter assertion-pick mode (one click → one assertion →
back to recording). Stop in the popup to get a complete `import { test,
expect } from '@playwright/test'` test.

## AI suggestions (Phase 1, grounded)

When you pick an element with the backend connected, the service worker:

1. POSTs the capture (locators + element snapshot + bounded DOM excerpt) to
   `/api/captures` — the backend writes a row scoped to your project.
2. Asynchronously hits `/api/llm/suggest` with the new capture id.
3. The backend loads the project's corpus for that route pattern, builds a
   prompt-cached system + corpus block, calls Claude with the
   `suggest_assertions` tool schema, post-validates corpus membership,
   retries once on validation failure, and writes an audit row.
4. Suggestions stream back to the popup in a separate message; you see
   summary + assertions + edge-case ideas with rationale, model name,
   token cost, and grounded-corpus size.

If `ANTHROPIC_API_KEY` isn't set, AI features are off but the heuristic
locator pipeline keeps working. The popup honours `aiEnabled` in settings
so users can disable the panel without deconfiguring the backend.

## Setup

```bash
# 1. Install + run the backend
cd server
cp .env.example .env             # set ANTHROPIC_API_KEY for AI features
npm install
npm start                        # listens on http://localhost:7821

# 2. Create a project (one row in projects + an API key)
npm run create-project -- "My App"
# → prints { id, name, apiKey, dailyBudgetUsd }

# 3. Load the extension
#    chrome://extensions → Developer Mode → Load unpacked → pick extension/

# 4. Open the extension's Settings (gear icon in the popup)
#    Paste the server URL and the project API key, click Save.
#    Hit "Test connection" to verify.
```

## Tests

```bash
# Extension core engine (jsdom)
npm install
npm test                         # 18 tests

# Backend (in-memory SQLite + mocked Claude provider — no real API calls)
cd server
npm install
npm test                         # 28 tests
```

The MockProvider fixture lets tests assert exactly what the LLM is asked
and what the validator does with its replies; no network is touched
during CI.

## Reliability guarantees

What you can rely on:

- **Locator candidates** — every one resolves to exactly one element on
  the live DOM at pick time. Verifier and runtime use the same exact
  matching semantics, so a verified candidate will not silently expand to
  multiple matches at test time.
- **AI suggestions** — every `locatorRef` in a returned assertion or edge
  case is in the input corpus. Hallucinations trigger a single retry; a
  second hallucination is surfaced as a 502 instead of a degraded answer.
- **Cost circuit-breaker** — the service worker can't fire more LLM calls
  than the project's daily USD budget allows. The check runs in a single
  SQLite transaction so two concurrent picks can't both pass it.
- **Audit trail** — every LLM call writes a row to `audit_log` with model,
  token usage (including cache hit/miss), cost, latency, and any error.

What's deliberately not in this version (and why):

- **Replay validation of generated tests** (Phase 2). Without an actual
  headless Playwright pool re-running the generated test, "AI test
  authoring" is a hallucination vector. We ship the corpus + grounding
  layer it'll plug into; the replay pool is a follow-up.
- **CI repair PRs** (Phase 3) — needs a CI plugin and DOM-diff infra.
- **POM / Gherkin export** (Phase 4) — relatively cheap once Phase 2 is in.
- **Coverage gap analytics** (Phase 5) — depends on enough corpus density.

## Endpoints

```
GET    /health
POST   /api/captures            { url, candidates[], snapshot, domExcerpt }
GET    /api/captures?route=     list, optionally filter by route pattern
GET    /api/captures/:id
DELETE /api/captures            wipe project corpus
POST   /api/llm/suggest         { captureId, pageContext? }
GET    /api/audit
GET    /api/spend               { spend, budget }
```

All `/api/...` routes require `X-Anchor-Key: ak_...` issued by
`npm run create-project`.

## Pricing & cost control

The cost ledger uses public Claude list prices in `server/src/llm/pricing.js`.
Update the table when prices change; nothing else needs to change.
Per-project daily budgets live in `projects.daily_budget_usd` — update
directly in SQL or via a future admin endpoint.

Prompt-caching cuts cost ~80% across a session: the system prompt and
project corpus are cache-controlled, so only the focal element + page
context are charged at the full input rate per call.

## License

Internal. This is a product codebase, not a sample. Adapt freely inside
your organisation; do not redistribute without authorisation.
#   s e l e c t o r h u b - a u t o m a t i o n  
 