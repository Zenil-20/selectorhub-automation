// In-memory token bucket per project. Resets every 60 seconds. Applies only
// to LLM endpoints — captures are cheap and we want them fast.
//
// Why in-memory and not Redis: this server is a single process. If you
// horizontally scale, swap in Redis here. The interface stays identical.
import { config } from '../config.js';

const WINDOW_MS = 60_000;
const buckets = new Map(); // projectId → { count, resetAt }

// Test seam — clear state between tests so prior runs don't carry over.
export function _resetRateLimits() { buckets.clear(); }

export function rateLimitLLM(req, res, next) {
  const key = req.project?.id;
  if (!key) return next(); // projectAuth missing — let auth middleware handle it
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > config.llmRpm) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      ok: false,
      error: `LLM rate limit reached: ${config.llmRpm} requests/minute. Retry in ${retryAfterSec}s.`,
      code: 'RATE_LIMIT',
      retryAfterSec,
    });
  }
  next();
}
