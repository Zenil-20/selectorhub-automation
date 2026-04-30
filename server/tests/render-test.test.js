import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStep, renderTest, mergeEnrichment } from '../src/llm/render-test.js';

const corpus = [
  { captureId: 'cap_login', best: { strategy: 'role', role: 'button', name: 'Sign in' } },
  { captureId: 'cap_email', best: { strategy: 'label', value: 'Email' } },
  { captureId: 'cap_welcome', best: { strategy: 'text', value: 'Welcome back' } },
];
const corpusById = new Map(corpus.map((c) => [c.captureId, c]));

test('renderStep: goto and expectURL do not need a locator', () => {
  assert.equal(
    renderStep({ type: 'goto', url: 'https://x/login' }, corpusById),
    `  await page.goto('https://x/login');`,
  );
  assert.equal(
    renderStep({ type: 'expectURL', url: '/dashboard' }, corpusById),
    `  await expect(page).toHaveURL('/dashboard');`,
  );
});

test('renderStep: locatorRef resolves through corpus to the right Playwright code', () => {
  assert.equal(
    renderStep({ type: 'fill', locatorRef: 'cap_email', value: 'a@b.c' }, corpusById),
    `  await page.getByLabel('Email', { exact: true }).fill('a@b.c');`,
  );
  assert.equal(
    renderStep({ type: 'click', locatorRef: 'cap_login' }, corpusById),
    `  await page.getByRole('button', { name: 'Sign in', exact: true }).click();`,
  );
  assert.equal(
    renderStep({ type: 'expectText', locatorRef: 'cap_welcome', value: 'Welcome back' }, corpusById),
    `  await expect(page.getByText('Welcome back', { exact: true })).toHaveText('Welcome back');`,
  );
});

test('renderStep: missing locator resolves to a self-documenting comment', () => {
  const out = renderStep({ type: 'click', locatorRef: 'cap_GHOST' }, corpusById);
  assert.match(out, /skipped click: missing locator \(corpus miss: cap_GHOST\)/);
});

test('renderStep: raw locator on the step takes precedence over locatorRef', () => {
  const step = {
    type: 'click',
    locator: { strategy: 'testid', value: 'inline-btn' },
    locatorRef: 'cap_login',
  };
  assert.match(renderStep(step, corpusById), /getByTestId\('inline-btn'\)/);
});

test('renderTest assembles a full Playwright file with header + body', () => {
  const code = renderTest({
    testName: 'logs in successfully',
    steps: [
      { type: 'goto', url: 'https://x/login' },
      { type: 'fill', locatorRef: 'cap_email', value: 'a@b.c' },
      { type: 'click', locatorRef: 'cap_login' },
      { type: 'expectVisible', locatorRef: 'cap_welcome' },
    ],
    corpus,
  });
  assert.match(code, /import \{ test, expect \} from '@playwright\/test';/);
  assert.match(code, /test\('logs in successfully'/);
  assert.match(code, /\.fill\('a@b\.c'\);/);
  assert.match(code, /\.click\(\);/);
  assert.match(code, /\.toBeVisible\(\);/);
});

test('mergeEnrichment splices DESC-by-index without shifting earlier insertions', () => {
  const raw = [
    { type: 'goto', url: 'https://x/login' },        // 0
    { type: 'fill', locator: { strategy: 'label', value: 'Email' }, value: 'a@b.c' }, // 1
    { type: 'click', locator: { strategy: 'role', role: 'button', name: 'Sign in' } }, // 2
  ];
  const added = [
    { insertAfterIndex: 0, type: 'expectVisible', locatorRef: 'cap_email', rationale: 'login form rendered' },
    { insertAfterIndex: 2, type: 'expectVisible', locatorRef: 'cap_welcome', rationale: 'reached dashboard' },
  ];
  const merged = mergeEnrichment({ rawSteps: raw, addedAssertions: added, corpus });
  // Expected order:
  //  0: goto
  //  1: expectVisible(cap_email)        ← inserted after 0
  //  2: fill                            ← was 1
  //  3: click                           ← was 2
  //  4: expectVisible(cap_welcome)      ← inserted after 2 (the original 2)
  assert.equal(merged.length, 5);
  assert.equal(merged[0].type, 'goto');
  assert.equal(merged[1].type, 'expectVisible');
  assert.equal(merged[1].locatorRef, 'cap_email');
  assert.equal(merged[2].type, 'fill');
  assert.equal(merged[3].type, 'click');
  assert.equal(merged[4].type, 'expectVisible');
  assert.equal(merged[4].locatorRef, 'cap_welcome');
});

test('mergeEnrichment with insertAfterIndex=-1 inserts at the very start', () => {
  const merged = mergeEnrichment({
    rawSteps: [{ type: 'goto', url: '/x' }],
    addedAssertions: [{ insertAfterIndex: -1, type: 'expectVisible', locatorRef: 'cap_login', rationale: 'r' }],
    corpus,
  });
  assert.equal(merged[0].type, 'expectVisible');
  assert.equal(merged[1].type, 'goto');
});
