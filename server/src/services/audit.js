// Append-only audit log for every LLM call. Required when a customer asks
// "what exactly did the model see and what did it return?". Never deleted.
import { getDb, newId } from '../db.js';

export function recordAudit(rec) {
  const row = {
    id: newId('aud'),
    project_id: rec.projectId,
    kind: rec.kind,
    input_json: JSON.stringify(rec.input ?? {}),
    output_json: rec.output != null ? JSON.stringify(rec.output) : null,
    model: rec.model || null,
    input_tokens: rec.usage?.input_tokens ?? null,
    output_tokens: rec.usage?.output_tokens ?? null,
    cache_read_tokens: rec.usage?.cache_read_input_tokens ?? null,
    cache_creation_tokens: rec.usage?.cache_creation_input_tokens ?? null,
    cost_usd: rec.costUsd ?? null,
    latency_ms: rec.latencyMs ?? null,
    error: rec.error || null,
    created_at: Date.now(),
  };
  getDb().prepare(`
    INSERT INTO audit_log
      (id, project_id, kind, input_json, output_json, model,
       input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
       cost_usd, latency_ms, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.project_id, row.kind, row.input_json, row.output_json, row.model,
    row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_creation_tokens,
    row.cost_usd, row.latency_ms, row.error, row.created_at,
  );
  return row.id;
}

export function listAudit({ project, limit = 50, offset = 0, kind }) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const sql = `
    SELECT id, kind, model, input_tokens AS inputTokens, output_tokens AS outputTokens,
           cache_read_tokens AS cacheReadTokens, cache_creation_tokens AS cacheCreationTokens,
           cost_usd AS costUsd, latency_ms AS latencyMs, error, created_at AS createdAt
      FROM audit_log
     WHERE project_id = ? ${kind ? 'AND kind = ?' : ''}
     ORDER BY created_at DESC LIMIT ? OFFSET ?
  `;
  const params = kind ? [project.id, kind, lim, off] : [project.id, lim, off];
  return getDb().prepare(sql).all(...params);
}

export function getAuditEntry({ project, id }) {
  return getDb().prepare(
    `SELECT * FROM audit_log WHERE id = ? AND project_id = ?`
  ).get(id, project.id) || null;
}
