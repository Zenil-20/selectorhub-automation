// In-memory ring buffer. Swap for SQLite/Postgres without changing the
// route layer — keep this module's surface area minimal.

const MAX = 500;
const buffer = [];

export function add(entry) {
  buffer.unshift(entry);
  if (buffer.length > MAX) buffer.length = MAX;
  return entry;
}

export function list({ limit = 50, offset = 0 } = {}) {
  return buffer.slice(offset, offset + limit);
}

export function clear() {
  buffer.length = 0;
}

export function size() {
  return buffer.length;
}
