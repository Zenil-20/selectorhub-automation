import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  let dbOk = false;
  try { await getDb().execute('SELECT 1'); dbOk = true; } catch (_) { /* ignore */ }
  res.json({
    ok: true,
    service: 'anchor',
    version: '0.2.0',
    db: dbOk,
    llmConfigured: !!config.llmProvider,
    llmProvider: config.llmProvider,
    model: config.llmModel,
  });
});

export default router;
