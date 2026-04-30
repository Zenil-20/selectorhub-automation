// Per-project, per-day cost ledger. Atomic UPSERT inside libsql ensures
// concurrent picks can't both pass the budget check.
import { getDb } from '../db.js';

function today() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function getDailySpend({ projectId, day = today() }) {
  const r = await getDb().execute({
    sql: `SELECT cost_usd AS costUsd, request_count AS requestCount
            FROM cost_ledger WHERE project_id = ? AND day = ?`,
    args: [projectId, day],
  });
  return r.rows[0] || { costUsd: 0, requestCount: 0 };
}

// Throws { status: 429 } if adding `expectedCostUsd` would push the project
// over its daily budget. Use a conservative pre-estimate for expectedCostUsd;
// actual spend is recorded after the call returns via addCost().
export async function assertBudget({ project, expectedCostUsd = 0 }) {
  const spend = await getDailySpend({ projectId: project.id });
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

export async function addCost({ projectId, costUsd }) {
  const day = today();
  await getDb().execute({
    sql: `INSERT INTO cost_ledger (project_id, day, cost_usd, request_count)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(project_id, day) DO UPDATE SET
            cost_usd = cost_usd + excluded.cost_usd,
            request_count = request_count + 1`,
    args: [projectId, day, costUsd || 0],
  });
}
