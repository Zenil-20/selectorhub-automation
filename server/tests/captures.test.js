import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeFixture, fakeCapturePayload } from './helpers.js';

test('POST /api/captures stores and returns the dto', async () => {
  const { app, project } = await makeFixture();
  const res = await request(app)
    .post('/api/captures')
    .set('X-Anchor-Key', project.apiKey)
    .send(fakeCapturePayload());
  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.capture.id.startsWith('cap_'));
  assert.equal(res.body.capture.routePattern, '/cart');
  assert.equal(res.body.capture.bestLocator.strategy, 'testid');
});

test('captures are isolated per project (auth)', async () => {
  const { app, project } = await makeFixture();
  const res = await request(app)
    .post('/api/captures')
    .set('X-Anchor-Key', 'wrong-key')
    .send(fakeCapturePayload());
  assert.equal(res.status, 401);
});

test('GET /api/captures filters by route', async () => {
  const { app, project } = await makeFixture();
  await request(app).post('/api/captures').set('X-Anchor-Key', project.apiKey)
    .send(fakeCapturePayload({ overrides: { url: 'https://app.example/cart' } }));
  await request(app).post('/api/captures').set('X-Anchor-Key', project.apiKey)
    .send(fakeCapturePayload({ overrides: { url: 'https://app.example/profile' } }));

  const r1 = await request(app).get('/api/captures?route=/cart').set('X-Anchor-Key', project.apiKey);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.captures.length, 1);
  assert.equal(r1.body.captures[0].routePattern, '/cart');

  const r2 = await request(app).get('/api/captures').set('X-Anchor-Key', project.apiKey);
  assert.equal(r2.body.captures.length, 2);
});

test('rejects payload without candidates', async () => {
  const { app, project } = await makeFixture();
  const res = await request(app)
    .post('/api/captures')
    .set('X-Anchor-Key', project.apiKey)
    .send({ url: 'https://x', candidates: [] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /candidates\[\] is required/);
});

test('PII redaction strips email-shaped strings from domExcerpt', async () => {
  const { app, project } = await makeFixture();
  const res = await request(app)
    .post('/api/captures')
    .set('X-Anchor-Key', project.apiKey)
    .send(fakeCapturePayload({
      overrides: { domExcerpt: '<input value="alice@example.com" />' },
    }));
  assert.equal(res.status, 201);
  assert.match(res.body.capture.domExcerpt, /\[email\]/);
  assert.doesNotMatch(res.body.capture.domExcerpt, /alice@example/);
});
