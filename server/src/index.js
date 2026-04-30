import { createApp } from './app.js';
import { getDb } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

// Touch the DB so migrations run before the first request.
getDb();

const app = createApp();
app.listen(config.port, config.host, () => {
  logger.info('anchor.listening', { url: `http://${config.host}:${config.port}` });
});
