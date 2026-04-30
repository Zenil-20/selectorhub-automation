// Shared test scaffolding. Each test that needs DB calls makeFixture()
// to get a fresh in-memory SQLite + a project + an HTTP app handle.
import { initDb, closeDb } from '../src/db.js';
import { createProject } from '../src/services/projects.js';
import { createApp } from '../src/app.js';
import { MockProvider } from '../src/llm/mock.js';
import { _resetRateLimits } from '../src/middleware/rate-limit.js';

// Each test gets a fresh in-memory libsql DB. We MUST close any prior DB
// first, otherwise the libsql client's connection state from a previous
// test leaks across.
export async function makeFixture({ providerResponses = [] } = {}) {
  await closeDb();
  _resetRateLimits();
  const db = await initDb({ url: ':memory:' });
  const project = await createProject({ name: 'Test Project', dailyBudgetUsd: 1.0 });
  const provider = new MockProvider(providerResponses);
  const app = createApp({ providerOverride: provider });
  return { db, project, provider, app };
}

// Build a synthetic capture payload (the shape the extension sends).
export function fakeCapturePayload({ overrides = {} } = {}) {
  return {
    url: 'https://app.example/cart',
    description: '<button data-testid="checkout">Checkout</button>',
    candidates: [
      {
        strategy: 'testid', value: 'checkout', score: 100,
        code: { playwright: `await page.getByTestId('checkout').click();` },
      },
      {
        strategy: 'role', role: 'button', name: 'Checkout', score: 90,
        code: { playwright: `await page.getByRole('button', { name: 'Checkout', exact: true }).click();` },
      },
    ],
    snapshot: {
      tag: 'BUTTON', text: 'Checkout', value: null,
      attrs: { 'data-testid': 'checkout' }, visible: true,
    },
    domExcerpt: '<button data-testid="checkout">Checkout</button>',
    ...overrides,
  };
}

// Build a valid suggest_assertions tool-use response that references a
// supplied corpus captureId. Tests pass the focal captureId in.
export function validSuggestResponse({ captureIds, summary = 'A button to start checkout.' }) {
  const ids = Array.isArray(captureIds) ? captureIds : [captureIds];
  return {
    toolUse: {
      id: 'tu_test_1',
      name: 'suggest_assertions',
      input: {
        summary,
        assertions: [
          { type: 'toBeVisible', locatorRef: ids[0], rationale: 'core CTA must render' },
          { type: 'toHaveText', locatorRef: ids[0], value: 'Checkout', rationale: 'guards copy regression' },
          { type: 'toBeEnabled', locatorRef: ids[0], rationale: 'must be clickable in default state' },
        ],
        edgeCases: [
          {
            title: 'Empty cart should disable the CTA',
            steps: ['Navigate to /cart with no items', 'Observe checkout button'],
            relatedLocatorRefs: [ids[0]],
            rationale: 'common UX rule, easy to regress',
          },
        ],
      },
    },
    usage: { input_tokens: 800, output_tokens: 200 },
    model: 'claude-sonnet-4-6',
    stopReason: 'tool_use',
  };
}

export function withAuth(req, project) {
  return req.set('X-Anchor-Key', project.apiKey).set('Content-Type', 'application/json');
}

// Tool-use response shape for the emit_test tool (generate-test endpoint).
export function validEmitTestResponse({ captureIds, testName = 'logs in successfully' }) {
  const ids = Array.isArray(captureIds) ? captureIds : [captureIds];
  return {
    toolUse: {
      id: 'tu_emit_1',
      name: 'emit_test',
      input: {
        testName,
        rationale: 'verifies the user can authenticate with valid credentials',
        steps: [
          { type: 'goto', url: 'https://app.example/login' },
          { type: 'click', locatorRef: ids[0] },
          { type: 'expectVisible', locatorRef: ids[0] },
        ],
        missingCapabilities: [],
      },
    },
    usage: { input_tokens: 1200, output_tokens: 350 },
    model: 'claude-sonnet-4-6',
    stopReason: 'tool_use',
  };
}

// Tool-use response shape for enrich_recording.
export function validEnrichResponse({ captureIds, testName = 'completes login flow' }) {
  const ids = Array.isArray(captureIds) ? captureIds : [captureIds];
  return {
    toolUse: {
      id: 'tu_enrich_1',
      name: 'enrich_recording',
      input: {
        testName,
        rationale: 'covers the happy-path login interaction end-to-end',
        addedAssertions: [
          {
            insertAfterIndex: 0,
            type: 'expectVisible',
            locatorRef: ids[0],
            rationale: 'login form is rendered before user types',
          },
        ],
        followUpIdeas: [
          { title: 'invalid email shows validation error', rationale: 'guards form-validation regression' },
        ],
      },
    },
    usage: { input_tokens: 900, output_tokens: 250 },
    model: 'claude-sonnet-4-6',
    stopReason: 'tool_use',
  };
}
