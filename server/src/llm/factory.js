// Single place that knows how to pick a concrete provider from config.
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { config, requireLlmConfigured } from '../config.js';

export function buildProvider() {
  requireLlmConfigured();
  if (config.llmProvider === 'anthropic') {
    return new AnthropicProvider({ apiKey: config.anthropicApiKey, model: config.llmModel });
  }
  if (config.llmProvider === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      apiKey: config.llmApiKey,
      baseURL: config.llmBaseUrl,
      model: config.llmModel,
    });
  }
  // Should be unreachable thanks to requireLlmConfigured(), but be explicit.
  const err = new Error(`Unknown llmProvider: ${config.llmProvider}`);
  err.status = 503;
  throw err;
}
