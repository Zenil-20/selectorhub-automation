// SQLite via Node's built-in `node:sqlite` (Node 22+). No native compile,
// no `better-sqlite3`, ships with the runtime. The API surface we use is
// identical for our purposes: prepare/get/all/run + exec for schema.
import { DatabaseSync } from 'node:sqlite';
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

export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!_db) {
    _db = openDatabase();
    logger.info('database opened', { path: config.dbPath });
  }
  return _db;
}

export function setDb(db) { _db = db; }
export function closeDb() {
  if (_db) {
    try { _db.close(); } catch (_) { /* ignore */ }
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
