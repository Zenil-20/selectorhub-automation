// Bootstrap CLI: `npm run create-project -- "Acme Web App"` prints a
// usable project ID + API key for the extension config.
import { initDb } from '../db.js';
import { createProject } from '../services/projects.js';

await initDb();

const name = process.argv.slice(2).join(' ').trim();
if (!name) {
  console.error('Usage: npm run create-project -- "<project name>"');
  process.exit(1);
}

try {
  const p = await createProject({ name });
  console.log(JSON.stringify(p, null, 2));
  console.log('\nPaste the apiKey into the Anchor extension Settings.');
  process.exit(0);
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(2);
}
