import { Router } from 'express';
import { projectAuth } from '../middleware/project-auth.js';
import { createCapture, listCaptures, getCapture, clearProjectCaptures } from '../services/captures.js';

const router = Router();
router.use(projectAuth);

router.post('/captures', (req, res, next) => {
  try {
    const dto = createCapture({ project: req.project, payload: req.body });
    res.status(201).json({ ok: true, capture: dto });
  } catch (e) { next(e); }
});

router.get('/captures', (req, res, next) => {
  try {
    const list = listCaptures({
      project: req.project,
      limit: req.query.limit,
      offset: req.query.offset,
      route: req.query.route,
    });
    res.json({ ok: true, captures: list });
  } catch (e) { next(e); }
});

router.get('/captures/:id', (req, res, next) => {
  try {
    const dto = getCapture({ project: req.project, id: req.params.id });
    if (!dto) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, capture: dto });
  } catch (e) { next(e); }
});

router.delete('/captures', (req, res, next) => {
  try {
    clearProjectCaptures({ project: req.project });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
