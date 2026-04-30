import { createApp } from './app.js';
import { initDb } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

// Open the DB and apply migrations BEFORE binding the port — otherwise
// the first request would race against schema creation.
await initDb();

const app = createApp();
app.listen(config.port, config.host, () => {
  logger.info('anchor.listening', { url: `http://${config.host}:${config.port}` });
});
