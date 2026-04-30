// Project domain — multi-tenancy unit. Every other table is scoped to a
// project; the API key is the only credential the extension presents.
import { getDb, newId, newApiKey } from '../db.js';
import { config } from '../config.js';

export async function createProject({ name, dailyBudgetUsd = config.defaultDailyBudgetUsd }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  const id = newId('prj');
  const apiKey = newApiKey();
  await getDb().execute({
    sql: `INSERT INTO projects (id, name, api_key, created_at, daily_budget_usd)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, name.trim(), apiKey, Date.now(), dailyBudgetUsd],
  });
  return { id, name: name.trim(), apiKey, dailyBudgetUsd };
}

export async function findByApiKey(apiKey) {
  if (!apiKey) return null;
  const r = await getDb().execute({
    sql: `SELECT id, name, daily_budget_usd AS dailyBudgetUsd, pii_redaction AS piiRedaction
            FROM projects WHERE api_key = ?`,
    args: [apiKey],
  });
  return r.rows[0] || null;
}

export async function getProject(id) {
  const r = await getDb().execute({
    sql: `SELECT id, name, daily_budget_usd AS dailyBudgetUsd, pii_redaction AS piiRedaction,
                 created_at AS createdAt
            FROM projects WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] || null;
}

export async function listProjects() {
  const r = await getDb().execute(
    `SELECT id, name, daily_budget_usd AS dailyBudgetUsd, created_at AS createdAt
       FROM projects ORDER BY created_at DESC`
  );
  return r.rows;
}
