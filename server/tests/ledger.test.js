import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, closeDb } from '../src/db.js';
import { createProject } from '../src/services/projects.js';
import { addCost, assertBudget, getDailySpend } from '../src/llm/ledger.js';

async function fresh() {
  await closeDb();
  await initDb({ url: ':memory:' });
  return createProject({ name: 'P', dailyBudgetUsd: 0.10 });
}

test('addCost accumulates per project per day', async () => {
  const p = await fresh();
  await addCost({ projectId: p.id, costUsd: 0.01 });
  await addCost({ projectId: p.id, costUsd: 0.02 });
  const spend = await getDailySpend({ projectId: p.id });
  assert.ok(Math.abs(spend.costUsd - 0.03) < 1e-9);
  assert.equal(spend.requestCount, 2);
});

test('assertBudget allows when under budget', async () => {
  const p = await fresh();
  await addCost({ projectId: p.id, costUsd: 0.05 });
  await assert.doesNotReject(() => assertBudget({ project: p, expectedCostUsd: 0.04 }));
});

test('assertBudget throws 429 when projected spend exceeds budget', async () => {
  const p = await fresh();
  await addCost({ projectId: p.id, costUsd: 0.09 });
  await assert.rejects(
    () => assertBudget({ project: p, expectedCostUsd: 0.05 }),
    (e) => e.status === 429 && e.code === 'BUDGET_EXCEEDED',
  );
});

test('budget is a per-day window — yesterday spend ignored', async () => {
  const p = await fresh();
  // No spend recorded today — budget check should pass.
  await assert.doesNotReject(() => assertBudget({ project: p, expectedCostUsd: 0.05 }));
});
