// OpenAI-compatible provider — works with OpenAI, Groq, OpenRouter, Together,
// Ollama (`/v1`), or anything that speaks the chat-completions tool-calling
// dialect. Internally we keep our messages in Anthropic shape (because
// AnthropicProvider is the reference implementation); this provider does
// the bidirectional translation so the rest of the codebase doesn't care
// which model is on the other end.
import { LLMProvider } from './provider.js';

// ---- pure translation helpers (exported for unit tests) -----------------

export function translateSystem(systemBlocks) {
  if (!systemBlocks) return null;
  if (typeof systemBlocks === 'string') return systemBlocks;
  return systemBlocks.map((b) => b.text).join('\n\n');
}

export function translateTools(tools) {
  if (!tools || !tools.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export function translateToolChoice(tc) {
  if (!tc) return undefined;
  if (tc.type === 'tool' && tc.name) {
    return { type: 'function', function: { name: tc.name } };
  }
  if (tc.type === 'auto') return 'auto';
  if (tc.type === 'any') return 'required';
  return undefined;
}

// Anthropic-shaped messages → OpenAI chat-completions messages.
// Notably:
//   assistant:[tool_use]    →   {role:'assistant', tool_calls:[{...}]}
//   user:[tool_result]      →   {role:'tool', tool_call_id:'...', content:'...'}
export function translateMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    const toolUses = m.content.filter((c) => c.type === 'tool_use');
    const toolResults = m.content.filter((c) => c.type === 'tool_result');
    const texts = m.content.filter((c) => c.type === 'text');
    if (toolUses.length) {
      out.push({
        role: 'assistant',
        content: texts.map((t) => t.text).join('\n') || null,
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input) },
        })),
      });
    } else if (toolResults.length) {
      for (const tr of toolResults) {
        const content = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
        out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content });
      }
    } else if (texts.length) {
      out.push({ role: m.role, content: texts.map((t) => t.text).join('\n') });
    }
  }
  return out;
}

// Best-effort JSON parse for tool arguments. Free models occasionally emit
// near-JSON (trailing commas, smart quotes); we make a single repair pass
// then return null on failure so the caller's retry loop kicks in.
export function safeParseToolArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch (_) { /* fall through */ }
  // Strip trailing commas before } or ]
  const repaired = raw.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
  try { return JSON.parse(repaired); } catch (_) { return null; }
}

// ---- provider -----------------------------------------------------------

export class OpenAICompatibleProvider extends LLMProvider {
  constructor({ apiKey, baseURL, model, fetchImpl }) {
    super();
    if (!apiKey) throw new Error('OpenAICompatibleProvider requires apiKey');
    if (!baseURL) throw new Error('OpenAICompatibleProvider requires baseURL');
    if (!model) throw new Error('OpenAICompatibleProvider requires model');
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/$/, '');
    this.model = model;
    this.fetch = fetchImpl || globalThis.fetch.bind(globalThis);
  }

  async generate({ system, messages, tools, toolChoice, maxTokens = 2048, temperature = 0 }) {
    const oaiMessages = [];
    const sys = translateSystem(system);
    if (sys) oaiMessages.push({ role: 'system', content: sys });
    oaiMessages.push(...translateMessages(messages));

    const body = {
      model: this.model,
      messages: oaiMessages,
      max_tokens: maxTokens,
      temperature,
    };
    const oaiTools = translateTools(tools);
    if (oaiTools) body.tools = oaiTools;
    const tc = translateToolChoice(toolChoice);
    if (tc) body.tool_choice = tc;

    const url = `${this.baseURL}/chat/completions`;
    const r = await this.fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const err = new Error(`LLM API ${r.status}: ${text.slice(0, 400)}`);
      err.status = 502;
      throw err;
    }
    const data = await r.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;
    let toolUse = null;
    if (msg?.tool_calls?.length) {
      const tcResp = msg.tool_calls[0];
      const input = safeParseToolArgs(tcResp.function?.arguments);
      // If args couldn't be parsed, leave toolUse null so the caller retries.
      if (input != null) {
        toolUse = { id: tcResp.id, name: tcResp.function?.name, input };
      }
    }
    return {
      toolUse,
      text: msg?.content || null,
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || this.model,
      stopReason: choice?.finish_reason || 'stop',
    };
  }
}
