// Phase-1 service: take a focal capture, load relevant corpus, ask the LLM
// for grounded suggestions, validate the output, charge the project, audit.
//
// This file is the *only* place that knows how the pieces fit together.
// Routes call into here; tests inject a MockProvider and exercise this
// function directly.
import { loadCorpus, getCapture } from './captures.js';
import { recordAudit } from './audit.js';
import { SUGGEST_ASSERTIONS_TOOL } from '../llm/schemas.js';
import { SUGGEST_SYSTEM_PROMPT, corpusBlock, focalMessage } from '../llm/prompts.js';
import { validateSuggestionOutput } from '../llm/validate.js';
import { assertBudget, addCost } from '../llm/ledger.js';
import { priceForUsage } from '../llm/pricing.js';
import { logger } from '../logger.js';

const MAX_RETRIES = 1; // one retry on validation failure
const CORPUS_LIMIT = 60;

export async function generateSuggestions({ project, captureId, provider, pageContext }) {
  const focal = getCapture({ project, id: captureId });
  if (!focal) {
    throw Object.assign(new Error('Capture not found'), { status: 404 });
  }

  // Cheap pre-flight — block at this many cents *before* we call the model.
  // A typical Sonnet suggest call lands ~$0.003. The 1-cent threshold gives
  // us enough headroom to record the call even at the budget edge.
  assertBudget({ project, expectedCostUsd: 0.01 });

  const corpus = loadCorpus({ project, route: focal.routePattern, limit: CORPUS_LIMIT });
  const corpusByRoute = corpus;

  // If route corpus is empty, fall back to project-wide so the LLM has
  // *something* to ground on.
  const grounding = corpusByRoute.length > 0
    ? corpusByRoute
    : loadCorpus({ project, limit: CORPUS_LIMIT });

  // System block is split so we can mark the *invariant* part as cacheable;
  // the corpus changes when new captures land but the system contract does not.
  const system = [
    { text: SUGGEST_SYSTEM_PROMPT, cache: true },
    { text: corpusBlock(grounding), cache: true },
  ];

  const userText = focalMessage({
    focal: {
      captureId: focal.id, url: focal.url, route: focal.routePattern,
      description: focal.description, best: focal.bestLocator,
      snapshot: focal.snapshot, domExcerpt: focal.domExcerpt,
    },
    pageContext,
  });

  let lastError = null;
  let attempts = 0;
  let usage = null;
  let output = null;
  let model = null;
  let messages = [{ role: 'user', content: userText }];

  const startedAt = Date.now();

  while (attempts <= MAX_RETRIES) {
    attempts++;
    let resp;
    try {
      resp = await provider.generate({
        system,
        messages,
        tools: [SUGGEST_ASSERTIONS_TOOL],
        toolChoice: { type: 'tool', name: SUGGEST_ASSERTIONS_TOOL.name },
      });
    } catch (e) {
      lastError = e;
      break;
    }

    usage = resp.usage;
    model = resp.model;

    if (!resp.toolUse || resp.toolUse.name !== SUGGEST_ASSERTIONS_TOOL.name) {
      lastError = new Error('Model did not invoke suggest_assertions tool');
      break;
    }

    const candidate = resp.toolUse.input;
    const errors = validateSuggestionOutput(candidate, grounding);
    if (errors.length === 0) {
      output = candidate;
      break;
    }

    if (attempts > MAX_RETRIES) {
      lastError = Object.assign(new Error('Validation failed after retry'), {
        status: 502, validationErrors: errors,
      });
      break;
    }

    // Append tool_use + tool_result so the model sees its own previous attempt
    // and the validator's complaint, then asks again.
    messages = [
      ...messages,
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: resp.toolUse.id, name: resp.toolUse.name, input: candidate }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: resp.toolUse.id,
          is_error: true,
          content: 'Validation failed:\n- ' + errors.join('\n- ') +
                   '\nReturn another suggest_assertions call. Use only captureIds that exist in the corpus.',
        }],
      },
    ];
    logger.warn('llm.suggest.retry', { projectId: project.id, captureId, errors });
  }

  const latencyMs = Date.now() - startedAt;
  const costUsd = priceForUsage(model, usage);

  recordAudit({
    projectId: project.id,
    kind: 'suggest',
    input: { captureId, route: focal.routePattern, corpusSize: grounding.length, attempts },
    output: output || null,
    model, usage, costUsd, latencyMs,
    error: lastError ? lastError.message : null,
  });

  if (output) addCost({ projectId: project.id, costUsd });

  if (lastError) {
    if (!lastError.status) lastError.status = 502;
    throw lastError;
  }

  return {
    output,
    audit: { model, usage, costUsd, latencyMs, attempts, corpusSize: grounding.length },
  };
}
