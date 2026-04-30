// Resolve the calling project from the X-Anchor-Key header. Cheap O(1)
// lookup against the projects table; failure returns 401 immediately.
import { findByApiKey } from '../services/projects.js';

export function projectAuth(req, res, next) {
  const key = req.header('x-anchor-key') || '';
  const project = findByApiKey(key);
  if (!project) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing X-Anchor-Key' });
  }
  req.project = project;
  next();
}
