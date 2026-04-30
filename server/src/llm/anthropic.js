import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider } from './provider.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Wraps the Anthropic SDK in our provider contract. Two non-trivial things
// happen here:
//   1. Prompt-cache hints — caller passes `system` as an array of blocks;
//      we forward them, and add `cache_control: { type: 'ephemeral' }` to
//      any block whose `cache` flag is true. Cuts cost ~80% across a session.
//   2. Tool-choice forcing — when the caller wants structured output we
//      force the model to emit the tool call, no free-form prose path.
export class AnthropicProvider extends LLMProvider {
  constructor({ apiKey = config.anthropicApiKey, model = config.llmModel } = {}) {
    super();
    if (!apiKey) throw new Error('AnthropicProvider requires an apiKey');
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  _buildSystem(systemBlocks) {
    if (!systemBlocks) return undefined;
    if (typeof systemBlocks === 'string') return systemBlocks;
    return systemBlocks.map((b) => {
      const out = { type: 'text', text: b.text };
      if (b.cache) out.cache_control = { type: 'ephemeral' };
      return out;
    });
  }

  async generate({ system, messages, tools, toolChoice, maxTokens = 2048, temperature = 0 }) {
    const body = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages,
    };
    if (system) body.system = this._buildSystem(system);
    if (tools) body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;

    if (config.debugLlm) {
      logger.debug('llm.request', { model: this.model, body });
    }

    const resp = await this.client.messages.create(body);

    let toolUse = null;
    let text = null;
    for (const block of resp.content || []) {
      if (block.type === 'tool_use' && !toolUse) {
        toolUse = { name: block.name, input: block.input, id: block.id };
      } else if (block.type === 'text' && !text) {
        text = block.text;
      }
    }
    return {
      toolUse,
      text,
      usage: resp.usage || {},
      model: resp.model,
      stopReason: resp.stop_reason,
    };
  }
}
