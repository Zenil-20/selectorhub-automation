import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routePattern } from '../src/services/routes-pattern.js';

test('strips numeric ids', () => {
  assert.equal(routePattern('https://x/users/12345/orders'), '/users/:id/orders');
});

test('strips uuid segments', () => {
  assert.equal(
    routePattern('https://x/orgs/550e8400-e29b-41d4-a716-446655440000/billing'),
    '/orgs/:uuid/billing',
  );
});

test('strips long hex hashes', () => {
  assert.equal(routePattern('https://x/sessions/9c2af1bd24e0fe5a/end'), '/sessions/:hash/end');
});

test('strips date-shaped segments', () => {
  assert.equal(routePattern('https://x/reports/2026-04-30'), '/reports/:date');
});

test('strips slug+id suffixes', () => {
  assert.equal(routePattern('https://x/posts/intro-to-anchor-9c2af1bd'), '/posts/intro-to-anchor-:id');
});

test('preserves a clean static route', () => {
  assert.equal(routePattern('https://x/dashboard/billing'), '/dashboard/billing');
});

test('handles non-URL inputs gracefully', () => {
  assert.equal(routePattern('/checkout'), '/checkout');
  assert.equal(routePattern(''), '/');
});
