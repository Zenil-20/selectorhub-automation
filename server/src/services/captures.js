// Capture domain — every element a user picks becomes one row here. This
// table is the corpus the LLM is grounded against.
import { getDb, newId } from '../db.js';
import { routePattern } from './routes-pattern.js';

const MAX_DOM_EXCERPT = 8000;     // chars; trimmed serverside before persistence
const MAX_DESCRIPTION = 256;
const MAX_CANDIDATES = 20;

function trimString(s, n) {
  if (typeof s !== 'string') return null;
  return s.length > n ? s.slice(0, n) : s;
}

// Some best-effort PII scrubbing of DOM excerpts. Intentionally conservative —
// it's a defence-in-depth, not a regulatory boundary. Customers with strict
// requirements should set pii_redaction higher and review excerpts before LLM
// calls in their own pipeline.
const PII_PATTERNS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b\d{13,19}\b/g, '[card]'],                     // card-shaped digit runs
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]'],
  [/\bsk-[A-Za-z0-9_\-]{16,}\b/g, '[apikey]'],
];
function redact(text) {
  if (!text) return text;
  let out = text;
  for (const [re, rep] of PII_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function createCapture({ project, payload }) {
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
    id,
    project_id: project.id,
    url,
    route_pattern: routePattern(url),
    description: trimString(payload.description, MAX_DESCRIPTION),
    candidates_json: JSON.stringify(candidates),
    best_locator_json: JSON.stringify(candidates[0]),
    snapshot_json: payload.snapshot ? JSON.stringify(payload.snapshot) : null,
    dom_excerpt: payload.domExcerpt
      ? (project.piiRedaction ? redact(trimString(payload.domExcerpt, MAX_DOM_EXCERPT)) : trimString(payload.domExcerpt, MAX_DOM_EXCERPT))
      : null,
    created_at: Date.now(),
  };
  getDb().prepare(`
    INSERT INTO captures
      (id, project_id, url, route_pattern, description, candidates_json,
       best_locator_json, snapshot_json, dom_excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.project_id, row.url, row.route_pattern, row.description,
    row.candidates_json, row.best_locator_json, row.snapshot_json,
    row.dom_excerpt, row.created_at,
  );
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

export function getCapture({ project, id }) {
  const row = getDb().prepare(
    `SELECT * FROM captures WHERE id = ? AND project_id = ?`
  ).get(id, project.id);
  return row ? rowToDto(row) : null;
}

export function listCaptures({ project, limit = 50, offset = 0, route }) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  let sql, params;
  if (route) {
    sql = `SELECT * FROM captures WHERE project_id = ? AND route_pattern = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params = [project.id, route, lim, off];
  } else {
    sql = `SELECT * FROM captures WHERE project_id = ?
             ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params = [project.id, lim, off];
  }
  return getDb().prepare(sql).all(...params).map(rowToDto);
}

// Corpus loader for LLM grounding — returns a deduplicated set keyed on
// (strategy, value, role, name) so the LLM doesn't see 50 copies of the
// same picked element from repeated captures.
export function loadCorpus({ project, route, limit = 60 }) {
  const rows = getDb().prepare(`
    SELECT * FROM captures
     WHERE project_id = ? ${route ? 'AND route_pattern = ?' : ''}
     ORDER BY created_at DESC LIMIT ?
  `).all(...(route ? [project.id, route, limit] : [project.id, limit]));
  const seen = new Set();
  const corpus = [];
  for (const row of rows) {
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

export function clearProjectCaptures({ project }) {
  getDb().prepare(`DELETE FROM captures WHERE project_id = ?`).run(project.id);
}
