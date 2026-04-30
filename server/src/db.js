// SQLite via @libsql/client — works against:
//   - a local file URL (file:./data/anchor.db) for dev and on-host deploys
//   - a Turso libsql URL (libsql://name.turso.io) with auth token for free
//     cloud-hosted persistence
//   - an in-memory store (:memory:) for tests
//
// All three speak the same SQL dialect, so the rest of the codebase doesn't
// change. The libsql client's API is async-only, hence every service that
// touches the DB also has to be async.
import { createClient } from '@libsql/client';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

let _db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  daily_budget_usd REAL NOT NULL DEFAULT 5.0,
  pii_redaction INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  route_pattern TEXT NOT NULL,
  description TEXT,
  candidates_json TEXT NOT NULL,
  best_locator_json TEXT NOT NULL,
  snapshot_json TEXT,
  dom_excerpt TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captures_project_route ON captures(project_id, route_pattern);
CREATE INDEX IF NOT EXISTS idx_captures_project_created ON captures(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_project_created ON audit_log(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cost_ledger (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, day)
);
`;

// Ensure the parent directory exists for a local file URL so the libsql
// client doesn't fail with ENOENT.
function ensureLocalDir(url) {
  if (!url || !url.startsWith('file:')) return;
  const filePath = url.slice('file:'.length);
  if (filePath === ':memory:' || !filePath) return;
  const dir = path.dirname(path.resolve(filePath));
  mkdirSync(dir, { recursive: true });
}

export async function initDb({ url = config.dbUrl, authToken = config.dbAuthToken } = {}) {
  if (_db) return _db;
  ensureLocalDir(url);
  const db = createClient({ url, authToken: authToken || undefined });
  // executeMultiple is the documented way to run a multi-statement script
  // against libsql. Schema is idempotent (IF NOT EXISTS) so re-runs are safe.
  await db.executeMultiple(SCHEMA);
  _db = db;
  logger.info('database opened', { url: url.replace(/(authToken=)[^&]+/, '$1***') });
  return _db;
}

export function getDb() {
  if (!_db) throw new Error('Database not initialized; await initDb() before getDb().');
  return _db;
}

export function setDb(db) { _db = db; }

export async function closeDb() {
  if (_db) {
    try { await _db.close(); } catch (_) { /* ignore */ }
    _db = null;
  }
}

export function newId(prefix = '') {
  const id = crypto.randomBytes(8).toString('hex');
  return prefix ? `${prefix}_${id}` : id;
}

export function newApiKey() {
  return 'ak_' + crypto.randomBytes(24).toString('base64url');
}
