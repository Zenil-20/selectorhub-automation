import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSuggestionOutput } from '../src/llm/validate.js';

const corpus = [
  { captureId: 'cap_a' },
  { captureId: 'cap_b' },
];

test('passes a clean payload', () => {
  const errs = validateSuggestionOutput({
    summary: '...',
    assertions: [
      { type: 'toBeVisible', locatorRef: 'cap_a', rationale: 'r' },
      { type: 'toHaveText', locatorRef: 'cap_b', value: 'X', rationale: 'r' },
    ],
    edgeCases: [{ title: 't', relatedLocatorRefs: ['cap_a'], rationale: 'r' }],
  }, corpus);
  assert.deepEqual(errs, []);
});

test('rejects out-of-corpus locatorRef', () => {
  const errs = validateSuggestionOutput({
    summary: '...',
    assertions: [{ type: 'toBeVisible', locatorRef: 'cap_FAKE', rationale: 'r' }],
    edgeCases: [],
  }, corpus);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /not in the corpus/);
});

test('rejects out-of-corpus relatedLocatorRefs', () => {
  const errs = validateSuggestionOutput({
    summary: '...',
    assertions: [],
    edgeCases: [{ title: 't', relatedLocatorRefs: ['cap_FAKE'], rationale: 'r' }],
  }, corpus);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /relatedLocatorRefs/);
});

test('rejects toHaveAttribute without attribute', () => {
  const errs = validateSuggestionOutput({
    summary: '...',
    assertions: [{ type: 'toHaveAttribute', locatorRef: 'cap_a', value: 'x', rationale: 'r' }],
    edgeCases: [],
  }, corpus);
  assert.ok(errs.some((e) => /attribute/.test(e)));
});

test('rejects value-needing assertion without value', () => {
  const errs = validateSuggestionOutput({
    summary: '...',
    assertions: [{ type: 'toHaveText', locatorRef: 'cap_a', rationale: 'r' }],
    edgeCases: [],
  }, corpus);
  assert.ok(errs.some((e) => /value/.test(e)));
});

test('rejects malformed top-level shape', () => {
  assert.ok(validateSuggestionOutput(null, corpus).length > 0);
  assert.ok(validateSuggestionOutput({ assertions: 'x', edgeCases: [] }, corpus).length > 0);
});
