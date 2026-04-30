// Centralised, immutable config — read once at boot, fail fast if missing
// values are required at the call site.
//
// Provider auto-selection:
//   1. ANTHROPIC_API_KEY set       → Anthropic (paid, best tool calling)
//   2. ANCHOR_LLM_API_KEY set      → OpenAI-compatible (Groq / OpenRouter / Ollama / OpenAI)
//   3. neither                     → AI features disabled, heuristic locators still work.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function loadDotenv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotenv();

function pickProvider() {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.ANCHOR_LLM_API_KEY) return 'openai-compatible';
  return null;
}

function pickModel(provider) {
  if (process.env.ANCHOR_LLM_MODEL) return process.env.ANCHOR_LLM_MODEL;
  if (provider === 'anthropic') return 'claude-sonnet-4-6';
  // Default to a free Groq model that supports tool calling.
  return 'llama-3.3-70b-versatile';
}

const provider = pickProvider();

export const config = Object.freeze({
  port: Number(process.env.PORT) || 7821,
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.ANCHOR_DB_PATH || './data/anchor.db',

  llmProvider: provider,
  llmModel: pickModel(provider),

  // Anthropic creds
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // OpenAI-compatible creds (Groq is the recommended free default)
  llmApiKey: process.env.ANCHOR_LLM_API_KEY || '',
  llmBaseUrl: process.env.ANCHOR_LLM_BASE_URL || 'https://api.groq.com/openai/v1',

  defaultDailyBudgetUsd: Number(process.env.ANCHOR_DEFAULT_DAILY_BUDGET_USD) || 5.0,
  debugLlm: process.env.ANCHOR_DEBUG_LLM === '1',

  // Production hardening — comma-separated list of additional origins
  // beyond chrome-extension://* (e.g. a Vercel landing page that shows
  // health/status). Empty by default; the extension still works because
  // its origin scheme is always allowed.
  allowedOrigins: (process.env.ANCHOR_ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // LLM-route rate limit: requests per minute per project. Free Groq tier
  // is ~30/min on Llama 70B; we cap below that to leave headroom.
  llmRpm: Number(process.env.ANCHOR_LLM_RPM) || 25,
});

export function requireLlmConfigured() {
  if (!config.llmProvider) {
    const err = new Error(
      'No LLM provider configured. Set ANCHOR_LLM_API_KEY (Groq/OpenAI/etc) ' +
      'or ANTHROPIC_API_KEY in .env, then restart.'
    );
    err.status = 503;
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }
}
