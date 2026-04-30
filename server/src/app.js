// Express app factory — separated from listen() so tests instantiate
// fresh apps without binding a port.
import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import capturesRouter from './routes/captures.js';
import suggestRouter, { buildSuggestRouter } from './routes/suggest.js';
import generateTestRouter, { buildGenerateTestRouter } from './routes/generate-test.js';
import enrichRouter, { buildEnrichRouter } from './routes/enrich-recording.js';
import auditRouter from './routes/audit.js';
import { errorMiddleware } from './middleware/error.js';

export function createApp({ providerOverride } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '512kb' }));
  app.use('/', healthRouter);
  app.use('/api', capturesRouter);
  app.use('/api', providerOverride ? buildSuggestRouter({ providerOverride })       : suggestRouter);
  app.use('/api', providerOverride ? buildGenerateTestRouter({ providerOverride }) : generateTestRouter);
  app.use('/api', providerOverride ? buildEnrichRouter({ providerOverride })       : enrichRouter);
  app.use('/api', auditRouter);
  app.use(errorMiddleware);
  return app;
}
