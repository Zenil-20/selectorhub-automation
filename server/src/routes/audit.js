import { Router } from 'express';
import { projectAuth } from '../middleware/project-auth.js';
import { listAudit } from '../services/audit.js';
import { getDailySpend } from '../llm/ledger.js';

const router = Router();
router.use(projectAuth);

router.get('/audit', async (req, res, next) => {
  try {
    res.json({
      ok: true,
      audit: await listAudit({
        project: req.project,
        limit: req.query.limit,
        offset: req.query.offset,
        kind: req.query.kind,
      }),
    });
  } catch (e) { next(e); }
});

router.get('/spend', async (req, res, next) => {
  try {
    const spend = await getDailySpend({ projectId: req.project.id });
    res.json({ ok: true, spend, budget: { dailyUsd: req.project.dailyBudgetUsd } });
  } catch (e) { next(e); }
});

export default router;
