import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeFixture, fakeCapturePayload, validEmitTestResponse } from './helpers.js';

async function postCapture(app, project, payload = fakeCapturePayload()) {
  const r = await request(app).post('/api/captures').set('X-Anchor-Key', project.apiKey).send(payload);
  return r.body.capture;
}

test('generate-test: empty corpus returns 400 with EMPTY_CORPUS code', async () => {
  const { app, project } = await makeFixture();
  const res = await request(app)
    .post('/api/llm/generate-test')
    .set('X-Anchor-Key', project.apiKey)
    .send({ intent: 'login flow' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'EMPTY_CORPUS');
});

test('generate-test: happy path returns runnable Playwright code grounded in corpus', async () => {
  const { app, project, provider } = await makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue(validEmitTestResponse({ captureIds: cap.id, testName: 'logs in with valid creds' }));

  const res = await request(app)
    .post('/api/llm/generate-test')
    .set('X-Anchor-Key', project.apiKey)
    .send({ intent: 'verify a registered user can log in' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.code, /import \{ test, expect \} from '@playwright\/test';/);
  assert.match(res.body.code, /test\('logs in with valid creds'/);
  assert.match(res.body.code, /await page\.goto\(/);
  assert.equal(res.body.audit.attempts, 1);
});

test('generate-test: out-of-corpus locatorRef triggers retry, then succeeds', async () => {
  const { app, project, provider } = await makeFixture();
  const cap = await postCapture(app, project);

  provider.enqueue({
    toolUse: {
      id: 'tu_x', name: 'emit_test',
      input: {
        testName: 'x', rationale: 'x',
        steps: [
          { type: 'goto', url: '/' },
          { type: 'click', locatorRef: 'cap_GHOST' },
          { type: 'expectVisible', locatorRef: cap.id },
        ],
        missingCapabilities: [],
      },
    },
    usage: { input_tokens: 100, output_tokens: 30 }, model: 'claude-sonnet-4-6',
  });
  provider.enqueue(validEmitTestResponse({ captureIds: cap.id }));

  const res = await request(app)
    .post('/api/llm/generate-test')
    .set('X-Anchor-Key', project.apiKey)
    .send({ intent: 'login flow' });
  assert.equal(res.status, 200);
  assert.equal(res.body.audit.attempts, 2);
});

test('generate-test: rejects empty intent', async () => {
  const { app, project } = await makeFixture();
  const res = await request(app)
    .post('/api/llm/generate-test')
    .set('X-Anchor-Key', project.apiKey)
    .send({ intent: '   ' });
  assert.equal(res.status, 400);
});

test('generate-test: requires auth', async () => {
  const { app } = await makeFixture();
  const res = await request(app).post('/api/llm/generate-test').send({ intent: 'x' });
  assert.equal(res.status, 401);
});

test('generate-test: budget exceeded → 429, no provider call', async () => {
  const { app, project, provider, db } = await makeFixture();
  await postCapture(app, project);
  const today = new Date().toISOString().slice(0, 10);
  await db.execute({
    sql: `INSERT OR REPLACE INTO cost_ledger (project_id, day, cost_usd, request_count)
          VALUES (?, ?, ?, 0)`,
    args: [project.id, today, 1.0],
  });
  const res = await request(app)
    .post('/api/llm/generate-test')
    .set('X-Anchor-Key', project.apiKey)
    .send({ intent: 'login' });
  assert.equal(res.status, 429);
  assert.equal(provider.calls.length, 0);
});

test('generate-test: audit row written with kind=generate-test', async () => {
  const { app, project, provider } = await makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue(validEmitTestResponse({ captureIds: cap.id }));
  await request(app)
    .post('/api/llm/generate-test')
    .set('X-Anchor-Key', project.apiKey)
    .send({ intent: 'login' });
  const a = await request(app).get('/api/audit?kind=generate-test')
    .set('X-Anchor-Key', project.apiKey);
  assert.equal(a.body.audit.length, 1);
  assert.equal(a.body.audit[0].kind, 'generate-test');
});
