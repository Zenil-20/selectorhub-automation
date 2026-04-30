import { Router } from 'express';
import { projectAuth } from '../middleware/project-auth.js';
import { enrichRecording } from '../services/enrich-recording.js';
import { buildProvider } from '../llm/factory.js';

let cachedProvider = null;
function getProvider() {
  if (cachedProvider) return cachedProvider;
  cachedProvider = buildProvider();
  return cachedProvider;
}

export function buildEnrichRouter({ providerOverride } = {}) {
  const router = Router();
  router.use(projectAuth);
  router.post('/llm/enrich-recording', async (req, res, next) => {
    try {
      const provider = providerOverride || getProvider();
      const result = await enrichRecording({
        project: req.project,
        rawSteps: req.body?.rawSteps,
        provider,
      });
      res.json({ ok: true, ...result });
    } catch (e) { next(e); }
  });
  return router;
}
export default buildEnrichRouter();
