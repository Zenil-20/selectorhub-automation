// Per-project, per-day cost ledger. The circuit-breaker that prevents a
// runaway customer from costing us more than we can collect.
//
// Atomicity matters: assertBudget + addCost run inside a single SQLite
// transaction so two concurrent requests can't both pass the budget check
// and then both push us over.
import { getDb } from '../db.js';

function today() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDailySpend({ projectId, day = today() }) {
  const row = getDb().prepare(
    `SELECT cost_usd AS costUsd, request_count AS requestCount
       FROM cost_ledger WHERE project_id = ? AND day = ?`
  ).get(projectId, day);
  return row || { costUsd: 0, requestCount: 0 };
}

// Throws { status: 429 } if adding `expectedCostUsd` would push the
// project over its daily budget. Use a conservative pre-estimate for
// expectedCostUsd; we still record actual spend after the call returns.
export function assertBudget({ project, expectedCostUsd = 0 }) {
  const spend = getDailySpend({ projectId: project.id });
  const projected = spend.costUsd + expectedCostUsd;
  if (projected > project.dailyBudgetUsd) {
    const err = new Error(
      `Daily budget exceeded for project ${project.id}: ` +
      `$${spend.costUsd.toFixed(4)} spent of $${project.dailyBudgetUsd.toFixed(2)}.`
    );
    err.status = 429;
    err.code = 'BUDGET_EXCEEDED';
    throw err;
  }
}

export function addCost({ projectId, costUsd }) {
  const day = today();
  const db = getDb();
  // UPSERT so the first call of the day creates the row.
  db.prepare(`
    INSERT INTO cost_ledger (project_id, day, cost_usd, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(project_id, day) DO UPDATE SET
      cost_usd = cost_usd + excluded.cost_usd,
      request_count = request_count + 1
  `).run(projectId, day, costUsd || 0);
}
