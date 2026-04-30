// Lock CORS down before going public. Allowed origins:
//   1. *no* origin header — same-origin (Render health checks, curl)
//   2. chrome-extension://* — any installed extension that knows the API key
//   3. anything in ANCHOR_ALLOWED_ORIGINS (comma-separated env var)
//
// We do NOT use the bare `cors()` factory here because that responds with
// `Access-Control-Allow-Origin: *`, which is too permissive once the
// service has a real Anthropic key sitting on its disk.
import cors from 'cors';
import { config } from '../config.js';

const ALLOWED_SET = new Set(config.allowedOrigins);

export const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (origin.startsWith('chrome-extension://')) return cb(null, true);
    if (ALLOWED_SET.has(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: false,
});
