import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateSystem, translateTools, translateToolChoice, translateMessages,
  safeParseToolArgs, OpenAICompatibleProvider,
} from '../src/llm/openai-compatible.js';

test('translateSystem joins cached blocks into a single string', () => {
  assert.equal(translateSystem('plain'), 'plain');
  assert.equal(
    translateSystem([{ text: 'A', cache: true }, { text: 'B' }]),
    'A\n\nB',
  );
});

test('translateTools maps Anthropic input_schema → OpenAI parameters', () => {
  const out = translateTools([{ name: 'foo', description: 'd', input_schema: { type: 'object' } }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'function');
  assert.equal(out[0].function.name, 'foo');
  assert.deepEqual(out[0].function.parameters, { type: 'object' });
});

test('translateToolChoice maps Anthropic forced-tool to OpenAI function-choice', () => {
  assert.deepEqual(
    translateToolChoice({ type: 'tool', name: 'foo' }),
    { type: 'function', function: { name: 'foo' } },
  );
  assert.equal(translateToolChoice({ type: 'auto' }), 'auto');
  assert.equal(translateToolChoice({ type: 'any' }), 'required');
});

test('translateMessages converts assistant tool_use into tool_calls', () => {
  const out = translateMessages([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'foo', input: { a: 1 } }] },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1].role, 'assistant');
  assert.equal(out[1].tool_calls[0].id, 'tu_1');
  assert.equal(out[1].tool_calls[0].function.name, 'foo');
  assert.equal(JSON.parse(out[1].tool_calls[0].function.arguments).a, 1);
});

test('translateMessages converts user tool_result into role:tool message', () => {
  const out = translateMessages([
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'oops' }] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'tool');
  assert.equal(out[0].tool_call_id, 'tu_1');
  assert.equal(out[0].content, 'oops');
});

test('safeParseToolArgs handles JSON, near-JSON, and garbage', () => {
  assert.deepEqual(safeParseToolArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(safeParseToolArgs('{"a":1,}'), { a: 1 }); // trailing comma
  assert.deepEqual(safeParseToolArgs({ a: 1 }), { a: 1 });    // already-object
  assert.equal(safeParseToolArgs('not json at all'), null);
});

test('provider issues fetch with right URL, headers, and body', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({
        model: 'llama-3.3-70b-versatile',
        choices: [{
          message: {
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'suggest_assertions', arguments: '{"summary":"ok","assertions":[],"edgeCases":[]}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  };
  const p = new OpenAICompatibleProvider({
    apiKey: 'gsk_test', baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile', fetchImpl: fakeFetch,
  });
  const r = await p.generate({
    system: [{ text: 'sys', cache: true }],
    messages: [{ role: 'user', content: 'go' }],
    tools: [{ name: 'suggest_assertions', description: 'x', input_schema: { type: 'object' } }],
    toolChoice: { type: 'tool', name: 'suggest_assertions' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer gsk_test');
  const sentBody = JSON.parse(calls[0].opts.body);
  assert.equal(sentBody.model, 'llama-3.3-70b-versatile');
  assert.equal(sentBody.messages[0].role, 'system');
  assert.equal(sentBody.messages[0].content, 'sys');
  assert.equal(sentBody.tools[0].type, 'function');
  assert.deepEqual(sentBody.tool_choice, { type: 'function', function: { name: 'suggest_assertions' } });
  assert.equal(r.toolUse.name, 'suggest_assertions');
  assert.equal(r.usage.input_tokens, 10);
  assert.equal(r.usage.output_tokens, 5);
});

test('provider returns null toolUse when arguments are unparseable (caller will retry)', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      model: 'm', choices: [{
        message: { tool_calls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '<<malformed>>' } }] },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  });
  const p = new OpenAICompatibleProvider({
    apiKey: 'k', baseURL: 'http://x', model: 'm', fetchImpl: fakeFetch,
  });
  const r = await p.generate({ messages: [{ role: 'user', content: 'go' }] });
  assert.equal(r.toolUse, null);
});

test('provider surfaces non-2xx as a 502 error with body excerpt', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 401, text: async () => '{"error":{"message":"invalid api key"}}',
  });
  const p = new OpenAICompatibleProvider({
    apiKey: 'bad', baseURL: 'http://x', model: 'm', fetchImpl: fakeFetch,
  });
  await assert.rejects(
    () => p.generate({ messages: [{ role: 'user', content: 'go' }] }),
    (e) => e.status === 502 && /401/.test(e.message),
  );
});
