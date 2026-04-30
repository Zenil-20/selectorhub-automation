import { Router } from 'express';
import { projectAuth } from '../middleware/project-auth.js';
import { rateLimitLLM } from '../middleware/rate-limit.js';
import { generateSuggestions } from '../services/suggest.js';
import { buildProvider } from '../llm/factory.js';

// Lazily create the production provider so importing this module without
// any LLM key doesn't blow up on boot. The instance is created the first
// time a real LLM call is needed.
let cachedProvider = null;
function getProvider() {
  if (cachedProvider) return cachedProvider;
  cachedProvider = buildProvider();
  return cachedProvider;
}

// Test seam — let the test file inject a MockProvider. Set to null to
// resume normal lookup. Never use this from production code.
export function _injectProvider(p) { cachedProvider = p; }

export function buildSuggestRouter({ providerOverride } = {}) {
  const router = Router();
  router.use(projectAuth);
  router.use(rateLimitLLM);

  router.post('/llm/suggest', async (req, res, next) => {
    try {
      const provider = providerOverride || getProvider();
      const captureId = req.body?.captureId;
      if (!captureId) {
        return res.status(400).json({ ok: false, error: 'captureId is required' });
      }
      const result = await generateSuggestions({
        project: req.project,
        captureId,
        provider,
        pageContext: req.body.pageContext,
      });
      res.json({ ok: true, ...result });
    } catch (e) { next(e); }
  });

  return router;
}

export default buildSuggestRouter();
