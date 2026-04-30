// Phase-2 orchestrator: natural-language intent → grounded Playwright test.
//
// Flow mirrors suggest.js but with a different tool, a different prompt,
// and a wider corpus window (we want to give the model a fuller view of
// the project so it can find related elements outside the focal route).
import { loadCorpus } from './captures.js';
import { recordAudit } from './audit.js';
import { EMIT_TEST_TOOL } from '../llm/schemas.js';
import { EMIT_TEST_SYSTEM_PROMPT, corpusBlock } from '../llm/prompts.js';
import { validateTestOutput } from '../llm/validate.js';
import { assertBudget, addCost } from '../llm/ledger.js';
import { priceForUsage } from '../llm/pricing.js';
import { renderTest } from '../llm/render-test.js';
import { logger } from '../logger.js';

const MAX_RETRIES = 1;
const ROUTE_CORPUS_LIMIT = 60;
const WIDE_CORPUS_LIMIT = 80;
const MIN_GROUNDING_SIZE = 5;

export async function generateTest({ project, intent, route, provider }) {
  if (!intent || typeof intent !== 'string' || !intent.trim()) {
    throw Object.assign(new Error('intent is required'), { status: 400 });
  }
  assertBudget({ project, expectedCostUsd: 0.02 });

  // Prefer route-scoped corpus, but fall back to project-wide if too thin
  // to be useful — a 5-capture corpus rarely has enough flow context.
  const routeCorpus = route ? loadCorpus({ project, route, limit: ROUTE_CORPUS_LIMIT }) : [];
  const corpus = routeCorpus.length >= MIN_GROUNDING_SIZE
    ? routeCorpus
    : loadCorpus({ project, limit: WIDE_CORPUS_LIMIT });

  if (corpus.length === 0) {
    throw Object.assign(new Error(
      'No captures in this project yet. Pick a few elements first so the model has locators to ground against.'
    ), { status: 400, code: 'EMPTY_CORPUS' });
  }

  const system = [
    { text: EMIT_TEST_SYSTEM_PROMPT, cache: true },
    { text: corpusBlock(corpus), cache: true },
  ];
  const userText = [
    `Test intent:`,
    intent.trim(),
    '',
    route ? `Route hint: ${route}` : '',
    `Generate a complete Playwright test as an emit_test tool call.`,
  ].filter(Boolean).join('\n');

  let messages = [{ role: 'user', content: userText }];
  let lastError = null;
  let attempts = 0;
  let usage = null;
  let output = null;
  let model = null;
  const startedAt = Date.now();

  while (attempts <= MAX_RETRIES) {
    attempts++;
    let resp;
    try {
      resp = await provider.generate({
        system,
        messages,
        tools: [EMIT_TEST_TOOL],
        toolChoice: { type: 'tool', name: EMIT_TEST_TOOL.name },
        maxTokens: 4096,
      });
    } catch (e) { lastError = e; break; }

    usage = resp.usage; model = resp.model;
    if (!resp.toolUse || resp.toolUse.name !== EMIT_TEST_TOOL.name) {
      lastError = new Error('Model did not invoke emit_test tool');
      break;
    }
    const candidate = resp.toolUse.input;
    const errors = validateTestOutput(candidate, corpus);
    if (errors.length === 0) { output = candidate; break; }
    if (attempts > MAX_RETRIES) {
      lastError = Object.assign(new Error('Validation failed after retry'), {
        status: 502, validationErrors: errors,
      });
      break;
    }
    messages = [
      ...messages,
      { role: 'assistant', content: [{ type: 'tool_use', id: resp.toolUse.id, name: resp.toolUse.name, input: candidate }] },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: resp.toolUse.id,
          is_error: true,
          content: 'Validation failed:\n- ' + errors.join('\n- ') +
                   '\nReturn another emit_test call. Use only captureIds that exist in the corpus.',
        }],
      },
    ];
    logger.warn('llm.generate-test.retry', { projectId: project.id, errors });
  }

  const latencyMs = Date.now() - startedAt;
  const costUsd = priceForUsage(model, usage);

  recordAudit({
    projectId: project.id, kind: 'generate-test',
    input: { intent: intent.slice(0, 500), route, corpusSize: corpus.length, attempts },
    output: output || null, model, usage, costUsd, latencyMs,
    error: lastError ? lastError.message : null,
  });
  if (output) addCost({ projectId: project.id, costUsd });

  if (lastError) {
    if (!lastError.status) lastError.status = 502;
    throw lastError;
  }

  const code = renderTest({ testName: output.testName, steps: output.steps, corpus });
  return {
    output, code,
    audit: { model, usage, costUsd, latencyMs, attempts, corpusSize: corpus.length },
  };
}
