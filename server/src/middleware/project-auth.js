// Resolve the calling project from the X-Anchor-Key header. Now async
// because the DB lookup is async with libsql.
import { findByApiKey } from '../services/projects.js';

export async function projectAuth(req, res, next) {
  const key = req.header('x-anchor-key') || '';
  try {
    const project = await findByApiKey(key);
    if (!project) {
      return res.status(401).json({ ok: false, error: 'Invalid or missing X-Anchor-Key' });
    }
    req.project = project;
    next();
  } catch (e) {
    next(e);
  }
}
