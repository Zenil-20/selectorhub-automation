import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeFixture, fakeCapturePayload, validEnrichResponse } from './helpers.js';

async function postCapture(app, project, payload = fakeCapturePayload()) {
  const r = await request(app).post('/api/captures').set('X-Anchor-Key', project.apiKey).send(payload);
  return r.body.capture;
}

const RAW_STEPS = [
  { type: 'goto', url: 'https://app.example/login' },
  { type: 'fill', locator: { strategy: 'label', value: 'Email' }, value: 'user@example.com' },
  { type: 'fill', locator: { strategy: 'label', value: 'Password' }, value: 'secret' },
  { type: 'click', locator: { strategy: 'role', role: 'button', name: 'Sign in' } },
];

test('enrich-recording: happy path emits a polished test grounded in corpus', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue(validEnrichResponse({ captureIds: cap.id, testName: 'completes login flow' }));

  const res = await request(app)
    .post('/api/llm/enrich-recording')
    .set('X-Anchor-Key', project.apiKey)
    .send({ rawSteps: RAW_STEPS });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.code, /test\('completes login flow'/);
  // Original recorded steps preserved.
  assert.match(res.body.code, /await page\.goto\('https:\/\/app\.example\/login'\);/);
  assert.match(res.body.code, /\.fill\('user@example\.com'\);/);
  // Inserted assertion came from the LLM and resolved through corpus.
  assert.match(res.body.code, /await expect\(.*\)\.toBeVisible\(\);/);
});

test('enrich-recording: empty rawSteps returns 400', async () => {
  const { app, project } = makeFixture();
  await postCapture(app, project);
  const res = await request(app)
    .post('/api/llm/enrich-recording')
    .set('X-Anchor-Key', project.apiKey)
    .send({ rawSteps: [] });
  assert.equal(res.status, 400);
});

test('enrich-recording: empty corpus returns 400 EMPTY_CORPUS', async () => {
  const { app, project } = makeFixture();
  const res = await request(app)
    .post('/api/llm/enrich-recording')
    .set('X-Anchor-Key', project.apiKey)
    .send({ rawSteps: RAW_STEPS });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'EMPTY_CORPUS');
});

test('enrich-recording: out-of-corpus assertion locatorRef triggers retry', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue({
    toolUse: {
      id: 'tu_e1', name: 'enrich_recording',
      input: {
        testName: 't', rationale: 'r',
        addedAssertions: [{ insertAfterIndex: 0, type: 'expectVisible', locatorRef: 'cap_GHOST', rationale: 'r' }],
      },
    },
    usage: { input_tokens: 100, output_tokens: 30 }, model: 'claude-sonnet-4-6',
  });
  provider.enqueue(validEnrichResponse({ captureIds: cap.id }));

  const res = await request(app)
    .post('/api/llm/enrich-recording')
    .set('X-Anchor-Key', project.apiKey)
    .send({ rawSteps: RAW_STEPS });
  assert.equal(res.status, 200);
  assert.equal(res.body.audit.attempts, 2);
});

test('enrich-recording: audit row uses kind=enrich-recording', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue(validEnrichResponse({ captureIds: cap.id }));
  await request(app).post('/api/llm/enrich-recording')
    .set('X-Anchor-Key', project.apiKey).send({ rawSteps: RAW_STEPS });
  const a = await request(app).get('/api/audit?kind=enrich-recording')
    .set('X-Anchor-Key', project.apiKey);
  assert.equal(a.body.audit.length, 1);
  assert.equal(a.body.audit[0].kind, 'enrich-recording');
});
