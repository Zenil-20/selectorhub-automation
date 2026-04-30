import { LLMProvider } from './provider.js';

// Test-and-development provider. Take a queue of canned responses; each
// generate() shifts one off and returns it. This is what makes the test
// suite deterministic and free of network calls.
export class MockProvider extends LLMProvider {
  constructor(responses = []) {
    super();
    this.queue = [...responses];
    this.calls = [];
  }

  enqueue(response) { this.queue.push(response); }

  async generate(opts) {
    this.calls.push(opts);
    if (!this.queue.length) {
      throw new Error('MockProvider exhausted; enqueue more responses');
    }
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return {
      toolUse: next.toolUse || null,
      text: next.text || null,
      usage: next.usage || { input_tokens: 100, output_tokens: 50 },
      model: next.model || 'mock-model',
      stopReason: next.stopReason || 'tool_use',
    };
  }
}
