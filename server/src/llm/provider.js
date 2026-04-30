// Provider interface — everything the rest of the codebase consumes goes
// through this shape. Anthropic is the production impl; MockProvider is the
// test impl. Adding another provider later means writing one new file.
//
// Contract:
//   generate({ system, messages, tools, toolChoice }) →
//     { toolUse: { name, input } | null,
//       text: string | null,
//       usage: { input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens? },
//       model: string,
//       stopReason: string }
export class LLMProvider {
  // eslint-disable-next-line no-unused-vars
  async generate(opts) {
    throw new Error('LLMProvider.generate is not implemented');
  }
}
