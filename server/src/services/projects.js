// Project domain — the unit of multi-tenancy. Every other table is scoped
// to a project; the API key is the only credential the extension presents.
import { getDb, newId, newApiKey } from '../db.js';
import { config } from '../config.js';

export function createProject({ name, dailyBudgetUsd = config.defaultDailyBudgetUsd }) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw Object.assign(new Error('name is required'), { status: 400 });
  }
  const id = newId('prj');
  const apiKey = newApiKey();
  getDb().prepare(`
    INSERT INTO projects (id, name, api_key, created_at, daily_budget_usd)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name.trim(), apiKey, Date.now(), dailyBudgetUsd);
  return { id, name: name.trim(), apiKey, dailyBudgetUsd };
}

export function findByApiKey(apiKey) {
  if (!apiKey) return null;
  return getDb().prepare(
    `SELECT id, name, daily_budget_usd AS dailyBudgetUsd, pii_redaction AS piiRedaction
       FROM projects WHERE api_key = ?`
  ).get(apiKey) || null;
}

export function getProject(id) {
  return getDb().prepare(
    `SELECT id, name, daily_budget_usd AS dailyBudgetUsd, pii_redaction AS piiRedaction, created_at AS createdAt
       FROM projects WHERE id = ?`
  ).get(id) || null;
}

export function listProjects() {
  return getDb().prepare(
    `SELECT id, name, daily_budget_usd AS dailyBudgetUsd, created_at AS createdAt
       FROM projects ORDER BY created_at DESC`
  ).all();
}
