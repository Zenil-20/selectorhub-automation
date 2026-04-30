import { Router } from 'express';
import { projectAuth } from '../middleware/project-auth.js';
import { rateLimitLLM } from '../middleware/rate-limit.js';
import { generateTest } from '../services/generate-test.js';
import { buildProvider } from '../llm/factory.js';

let cachedProvider = null;
function getProvider() {
  if (cachedProvider) return cachedProvider;
  cachedProvider = buildProvider();
  return cachedProvider;
}

export function buildGenerateTestRouter({ providerOverride } = {}) {
  const router = Router();
  router.use(projectAuth);
  router.use(rateLimitLLM);
  router.post('/llm/generate-test', async (req, res, next) => {
    try {
      const provider = providerOverride || getProvider();
      const result = await generateTest({
        project: req.project,
        intent: req.body?.intent,
        route: req.body?.route,
        provider,
      });
      res.json({ ok: true, ...result });
    } catch (e) { next(e); }
  });
  return router;
}
export default buildGenerateTestRouter();
