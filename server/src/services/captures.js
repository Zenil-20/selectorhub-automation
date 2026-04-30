// Capture domain — every element a user picks becomes one row here. This
// is the corpus the LLM is grounded against.
import { getDb, newId } from '../db.js';
import { routePattern } from './routes-pattern.js';

const MAX_DOM_EXCERPT = 8000;
const MAX_DESCRIPTION = 256;
const MAX_CANDIDATES = 20;

function trimString(s, n) {
  if (typeof s !== 'string') return null;
  return s.length > n ? s.slice(0, n) : s;
}

const PII_PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b\d{13,19}\b/g, '[card]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/\bsk-[A-Za-z0-9_\-]{16,}\b/g, '[apikey]'],
];
function redact(text) {
  if (!text) return text;
  let out = text;
  for (const [re, rep] of PII_PATTERNS) out = out.replace(re, rep);
  return out;
}

export async function createCapture({ project, payload }) {
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('Invalid payload'), { status: 400 });
  }
  const candidates = Array.isArray(payload.candidates) ? payload.candidates.slice(0, MAX_CANDIDATES) : [];
  if (!candidates.length) {
    throw Object.assign(new Error('candidates[] is required'), { status: 400 });
  }
  const url = String(payload.url || '').slice(0, 2048);
  const id = newId('cap');
  const row = {
    id, project_id: project.id, url, route_pattern: routePattern(url),
    description: trimString(payload.description, MAX_DESCRIPTION),
    candidates_json: JSON.stringify(candidates),
    best_locator_json: JSON.stringify(candidates[0]),
    snapshot_json: payload.snapshot ? JSON.stringify(payload.snapshot) : null,
    dom_excerpt: payload.domExcerpt
      ? (project.piiRedaction ? redact(trimString(payload.domExcerpt, MAX_DOM_EXCERPT)) : trimString(payload.domExcerpt, MAX_DOM_EXCERPT))
      : null,
    created_at: Date.now(),
  };
  await getDb().execute({
    sql: `INSERT INTO captures
            (id, project_id, url, route_pattern, description, candidates_json,
             best_locator_json, snapshot_json, dom_excerpt, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id, row.project_id, row.url, row.route_pattern, row.description,
      row.candidates_json, row.best_locator_json, row.snapshot_json,
      row.dom_excerpt, row.created_at,
    ],
  });
  return rowToDto(row);
}

function rowToDto(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    url: row.url,
    routePattern: row.route_pattern,
    description: row.description,
    candidates: JSON.parse(row.candidates_json),
    bestLocator: JSON.parse(row.best_locator_json),
    snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) : null,
    domExcerpt: row.dom_excerpt,
    createdAt: row.created_at,
  };
}

export async function getCapture({ project, id }) {
  const r = await getDb().execute({
    sql: `SELECT * FROM captures WHERE id = ? AND project_id = ?`,
    args: [id, project.id],
  });
  return r.rows[0] ? rowToDto(r.rows[0]) : null;
}

export async function listCaptures({ project, limit = 50, offset = 0, route }) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  let sql, args;
  if (route) {
    sql = `SELECT * FROM captures WHERE project_id = ? AND route_pattern = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    args = [project.id, route, lim, off];
  } else {
    sql = `SELECT * FROM captures WHERE project_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    args = [project.id, lim, off];
  }
  const r = await getDb().execute({ sql, args });
  return r.rows.map(rowToDto);
}

// Corpus loader for LLM grounding — deduplicated by (strategy, value, role, name).
export async function loadCorpus({ project, route, limit = 60 }) {
  const sql = `SELECT * FROM captures
                WHERE project_id = ? ${route ? 'AND route_pattern = ?' : ''}
                ORDER BY created_at DESC LIMIT ?`;
  const args = route ? [project.id, route, limit] : [project.id, limit];
  const r = await getDb().execute({ sql, args });
  const seen = new Set();
  const corpus = [];
  for (const row of r.rows) {
    const dto = rowToDto(row);
    const best = dto.bestLocator;
    if (!best) continue;
    const key = `${best.strategy}|${best.value || ''}|${best.role || ''}|${best.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    corpus.push({
      captureId: dto.id,
      url: dto.url,
      route: dto.routePattern,
      description: dto.description,
      best,
      snapshot: dto.snapshot,
      domExcerpt: dto.domExcerpt,
    });
  }
  return corpus;
}

export async function clearProjectCaptures({ project }) {
  await getDb().execute({
    sql: `DELETE FROM captures WHERE project_id = ?`,
    args: [project.id],
  });
}
