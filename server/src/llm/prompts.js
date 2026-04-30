// System prompt — the contract we hold the model to. Cached on Anthropic's
// side per the cache_control hint so the per-request token cost is just
// the focal element + the corpus delta.
export const SUGGEST_SYSTEM_PROMPT = `
You are Anchor's automation-test assistant. Your job is to look at one focal
DOM element a QA engineer just picked, plus a corpus of locators that have
been verified-unique on the same product, and propose useful Playwright
assertions and edge-case test ideas.

Hard constraints — violating any of these is a bug in your output:
1. Every locatorRef MUST be a captureId from the supplied corpus. Do not
   invent selectors. Do not output a captureId that was not in the corpus.
   If you can't find a fitting locator in the corpus, omit the suggestion.
2. Prefer assertions that verify *behaviour or content*, not just visibility.
   "toBeVisible" alone is the weakest assertion — only emit it when no
   stronger assertion applies.
3. Assertions must be deterministic — never assert on a value that would
   change between runs (timestamps, generated ids).
4. Edge-case ideas should be testable with the existing corpus. If a step
   would need a locator that isn't in the corpus, say so in the rationale
   and link only the captureIds that *are* available via relatedLocatorRefs.
5. Be concise. Rationale lines should be one short sentence.
`.trim();

// Caller-side helper — build the corpus block as a compact JSON array.
// Each entry is small (no DOM excerpt) so a project's full corpus fits
// inside a single cached system block.
export function corpusBlock(corpus) {
  const compact = corpus.map((c) => ({
    captureId: c.captureId,
    route: c.route,
    description: c.description,
    locator: c.best,
    snapshot: c.snapshot ? {
      tag: c.snapshot.tag, text: c.snapshot.text, value: c.snapshot.value,
      attrs: c.snapshot.attrs,
    } : null,
  }));
  return `Corpus (verified-unique locators for this project):\n${JSON.stringify(compact, null, 2)}`;
}

// Phase-2: emit_test system prompt. Same grounding contract — every
// step's locatorRef must come from the corpus.
export const EMIT_TEST_SYSTEM_PROMPT = `
You are Anchor's Playwright test author. Generate a complete test from the
engineer's intent, using ONLY locators from the supplied corpus.

Hard constraints:
1. Every step's locatorRef MUST be a captureId from the corpus. Do not
   invent. If the test cannot be expressed with the corpus, list what's
   missing in missingCapabilities and emit only the steps you can express.
2. Start with a goto step using a URL drawn from corpus entries (the
   "url" field on each capture).
3. End with at least one assertion that verifies the success outcome of
   the test. Prefer toHaveText / toHaveValue / toHaveURL over
   toBeVisible — the strongest deterministic assertion wins.
4. Do NOT assert on values that vary between runs (timestamps, generated
   ids, order-dependent text).
5. Between actions and the final assertion, add intermediate assertions
   only at points where state really must be checked (post-navigation,
   after async loads). Don't pad with redundant toBeVisible chains.
6. Each rationale string is one short sentence.
`.trim();

// Phase-2b: enrich_recording system prompt.
export const ENRICH_SYSTEM_PROMPT = `
You are Anchor's test reviewer. The engineer just recorded a raw
Playwright flow; your job is to make it production-quality.

Hard constraints:
1. Pick a descriptive test name in active voice ("logs in with valid
   credentials" — not "test_login").
2. Suggest assertions to insert at meaningful points: post-navigation,
   after async data appears, on the final success state.
3. Use ONLY locators from the supplied corpus for new assertions. Do not
   invent. Each assertion's locatorRef must be a captureId from the corpus.
4. Do NOT modify or remove existing recorded steps. You may only suggest
   *insertions* via insertAfterIndex.
5. Be conservative — 3 to 5 inserted assertions is usually right; do not
   over-assert. Skip obvious-from-context assertions.
6. followUpIdeas captures separate flows worth recording as their own
   tests (negative paths, edge cases). Don't push them as part of this
   test; they're hints to the engineer.
`.trim();

// Generic builder for a "raw recorded steps" block. We pass the steps
// with their locator objects (no captureIds) plus a synthetic index so
// the LLM's insertAfterIndex references are unambiguous.
export function recordedStepsBlock(rawSteps) {
  const compact = (rawSteps || []).map((s, i) => ({
    index: i, type: s.type, value: s.value, url: s.url,
    locator: s.locator || null,
  }));
  return `Recorded steps (immutable; reference by index in insertAfterIndex):\n${JSON.stringify(compact, null, 2)}`;
}

// User message — the focal element + page context, *not* cached.
export function focalMessage({ focal, pageContext }) {
  const compact = {
    captureId: focal.captureId,
    url: focal.url,
    route: focal.route,
    description: focal.description,
    locator: focal.best,
    snapshot: focal.snapshot,
    domExcerpt: focal.domExcerpt ? focal.domExcerpt.slice(0, 4000) : null,
    pageContext: pageContext || null,
  };
  return [
    'Focal element the engineer just picked:',
    JSON.stringify(compact, null, 2),
    '',
    'Suggest Playwright assertions and edge-case ideas. Every locatorRef must be a captureId from the corpus.',
  ].join('\n');
}
