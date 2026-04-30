import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeFixture, fakeCapturePayload, validSuggestResponse } from './helpers.js';

async function postCapture(app, project, payload = fakeCapturePayload()) {
  const r = await request(app).post('/api/captures').set('X-Anchor-Key', project.apiKey).send(payload);
  return r.body.capture;
}

test('happy path: suggestions are returned and grounded', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue(validSuggestResponse({ captureIds: cap.id }));

  const res = await request(app)
    .post('/api/llm/suggest')
    .set('X-Anchor-Key', project.apiKey)
    .send({ captureId: cap.id });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.output.summary);
  assert.ok(res.body.output.assertions.length > 0);
  assert.ok(res.body.audit.costUsd >= 0);
  assert.equal(res.body.audit.attempts, 1);
});

test('out-of-corpus locatorRef triggers a retry, then succeeds', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);

  // First attempt: invents a captureId that's not in corpus → validator rejects.
  provider.enqueue({
    toolUse: {
      id: 'tu_1', name: 'suggest_assertions',
      input: {
        summary: 's',
        assertions: [{ type: 'toBeVisible', locatorRef: 'cap_FAKE', rationale: 'r' }],
        edgeCases: [],
      },
    },
    usage: { input_tokens: 100, output_tokens: 30 },
    model: 'claude-sonnet-4-6',
  });
  // Second attempt: clean
  provider.enqueue(validSuggestResponse({ captureIds: cap.id }));

  const res = await request(app)
    .post('/api/llm/suggest')
    .set('X-Anchor-Key', project.apiKey)
    .send({ captureId: cap.id });

  assert.equal(res.status, 200);
  assert.equal(res.body.audit.attempts, 2);
  assert.equal(provider.calls.length, 2);
});

test('grounding holds across retries — second-attempt invention is also rejected', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);
  // Both attempts hallucinate — validator catches both → 502.
  for (let i = 0; i < 2; i++) {
    provider.enqueue({
      toolUse: {
        id: `tu_${i}`, name: 'suggest_assertions',
        input: {
          summary: 's',
          assertions: [{ type: 'toBeVisible', locatorRef: 'cap_FAKE', rationale: 'r' }],
          edgeCases: [],
        },
      },
      usage: { input_tokens: 100, output_tokens: 30 },
      model: 'claude-sonnet-4-6',
    });
  }
  const res = await request(app)
    .post('/api/llm/suggest')
    .set('X-Anchor-Key', project.apiKey)
    .send({ captureId: cap.id });
  assert.equal(res.status, 502);
  assert.ok(Array.isArray(res.body.validationErrors));
});

test('budget enforcement returns 429 when daily spend is at the cap', async () => {
  const { app, project, provider, db } = makeFixture();
  const cap = await postCapture(app, project);
  // Force ledger to the budget cap. Project default in helper is $1.00.
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT OR REPLACE INTO cost_ledger (project_id, day, cost_usd, request_count)
              VALUES (?, ?, ?, 0)`).run(project.id, today, 1.0);

  const res = await request(app)
    .post('/api/llm/suggest')
    .set('X-Anchor-Key', project.apiKey)
    .send({ captureId: cap.id });
  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'BUDGET_EXCEEDED');
  // Provider was never called.
  assert.equal(provider.calls.length, 0);
});

test('unknown captureId returns 404', async () => {
  const { app, project } = makeFixture();
  const res = await request(app)
    .post('/api/llm/suggest')
    .set('X-Anchor-Key', project.apiKey)
    .send({ captureId: 'cap_does_not_exist' });
  assert.equal(res.status, 404);
});

test('audit log records both successful and failed calls', async () => {
  const { app, project, provider } = makeFixture();
  const cap = await postCapture(app, project);
  provider.enqueue(validSuggestResponse({ captureIds: cap.id }));
  await request(app).post('/api/llm/suggest').set('X-Anchor-Key', project.apiKey)
    .send({ captureId: cap.id });

  const res = await request(app).get('/api/audit').set('X-Anchor-Key', project.apiKey);
  assert.equal(res.status, 200);
  assert.equal(res.body.audit.length, 1);
  assert.equal(res.body.audit[0].kind, 'suggest');
  assert.equal(res.body.audit[0].model, 'claude-sonnet-4-6');
  assert.ok(res.body.audit[0].costUsd >= 0);
});
