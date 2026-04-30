// Phase-2b: take a raw recorded flow + the project corpus, ask the LLM to
// (a) name it well and (b) propose assertions to insert at meaningful
// points. Existing recorded steps are immutable — only insertions are
// suggested. Resulting Playwright code is fully grounded.
import { loadCorpus } from './captures.js';
import { recordAudit } from './audit.js';
import { ENRICH_RECORDING_TOOL } from '../llm/schemas.js';
import { ENRICH_SYSTEM_PROMPT, corpusBlock, recordedStepsBlock } from '../llm/prompts.js';
import { validateEnrichmentOutput } from '../llm/validate.js';
import { assertBudget, addCost } from '../llm/ledger.js';
import { priceForUsage } from '../llm/pricing.js';
import { renderTest, mergeEnrichment } from '../llm/render-test.js';
import { routePattern } from './routes-pattern.js';
import { logger } from '../logger.js';

const MAX_RETRIES = 1;
const CORPUS_LIMIT = 80;

export async function enrichRecording({ project, rawSteps, provider }) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw Object.assign(new Error('rawSteps[] is required and must be non-empty'), { status: 400 });
  }
  assertBudget({ project, expectedCostUsd: 0.02 });

  // Build a route-scoped corpus around whichever URL the recording started
  // at; widen if too thin.
  const initialGoto = rawSteps.find((s) => s.type === 'goto');
  const route = initialGoto ? routePattern(initialGoto.url) : null;
  const routeCorpus = route ? loadCorpus({ project, route, limit: CORPUS_LIMIT }) : [];
  const corpus = routeCorpus.length >= 5 ? routeCorpus : loadCorpus({ project, limit: CORPUS_LIMIT });

  if (corpus.length === 0) {
    throw Object.assign(new Error(
      'No captures in this project yet. Pick a few elements first so the model has locators to ground against.'
    ), { status: 400, code: 'EMPTY_CORPUS' });
  }

  const system = [
    { text: ENRICH_SYSTEM_PROMPT, cache: true },
    { text: corpusBlock(corpus), cache: true },
  ];
  const userText = [
    recordedStepsBlock(rawSteps),
    '',
    'Return an enrich_recording tool call. Test name should describe the behaviour. ' +
    'addedAssertions[].insertAfterIndex must reference the recorded step indices above (-1 means before step 0).',
  ].join('\n');

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
        tools: [ENRICH_RECORDING_TOOL],
        toolChoice: { type: 'tool', name: ENRICH_RECORDING_TOOL.name },
        maxTokens: 3072,
      });
    } catch (e) { lastError = e; break; }

    usage = resp.usage; model = resp.model;
    if (!resp.toolUse || resp.toolUse.name !== ENRICH_RECORDING_TOOL.name) {
      lastError = new Error('Model did not invoke enrich_recording tool');
      break;
    }
    const candidate = resp.toolUse.input;
    const errors = validateEnrichmentOutput(candidate, corpus);
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
                   '\nReturn another enrich_recording call. Use only captureIds from the corpus.',
        }],
      },
    ];
    logger.warn('llm.enrich.retry', { projectId: project.id, errors });
  }

  const latencyMs = Date.now() - startedAt;
  const costUsd = priceForUsage(model, usage);

  recordAudit({
    projectId: project.id, kind: 'enrich-recording',
    input: { stepCount: rawSteps.length, route, corpusSize: corpus.length, attempts },
    output: output || null, model, usage, costUsd, latencyMs,
    error: lastError ? lastError.message : null,
  });
  if (output) addCost({ projectId: project.id, costUsd });

  if (lastError) {
    if (!lastError.status) lastError.status = 502;
    throw lastError;
  }

  const merged = mergeEnrichment({
    rawSteps, addedAssertions: output.addedAssertions, corpus,
  });
  const code = renderTest({ testName: output.testName, steps: merged, corpus });
  return {
    output, code, mergedSteps: merged,
    audit: { model, usage, costUsd, latencyMs, attempts, corpusSize: corpus.length },
  };
}
