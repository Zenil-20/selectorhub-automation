// Anthropic pricing — USD per token. These are dollars per million tokens
// converted into per-token; updating a number here is the only change
// needed when prices move. Numbers are public list prices.
//
// Important: the cache_read rate is far lower than the input rate, which
// is the entire reason we structure prompts so the system + corpus are
// cached. A typical project session pays the full input rate once for the
// first call, then ~10x cheaper cached reads for the rest.
const PRICES = {
  'claude-sonnet-4-6': {
    inputPerToken:        3.00 / 1_000_000,
    outputPerToken:      15.00 / 1_000_000,
    cacheReadPerToken:    0.30 / 1_000_000,
    cacheWritePerToken:   3.75 / 1_000_000,
  },
  'claude-opus-4-7': {
    inputPerToken:       15.00 / 1_000_000,
    outputPerToken:      75.00 / 1_000_000,
    cacheReadPerToken:    1.50 / 1_000_000,
    cacheWritePerToken:  18.75 / 1_000_000,
  },
  'claude-haiku-4-5-20251001': {
    inputPerToken:        1.00 / 1_000_000,
    outputPerToken:       5.00 / 1_000_000,
    cacheReadPerToken:    0.10 / 1_000_000,
    cacheWritePerToken:   1.25 / 1_000_000,
  },
};

// Free tier — Groq, OpenRouter ":free" variants, local Ollama. Listed
// explicitly so we don't accidentally start charging if someone swaps
// providers. Anything not in PRICES *and* not in FREE returns 0 cost.
const FREE = new Set([
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-3.1-70b-instruct:free',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
]);

export function priceForUsage(model, usage) {
  if (!usage) return 0;
  if (FREE.has(model)) return 0;
  const p = PRICES[model];
  if (!p) return 0; // unknown model — assume free; production swap should add a row above.
  const inputTok = usage.input_tokens || 0;
  const outputTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  return (
    inputTok * p.inputPerToken +
    outputTok * p.outputPerToken +
    cacheRead * p.cacheReadPerToken +
    cacheCreate * p.cacheWritePerToken
  );
}

export function listSupportedModels() { return Object.keys(PRICES); }
