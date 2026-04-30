// Tiny structured logger. Avoids pulling in winston/pino for a backend
// this size; the format is JSON-line per record so a real log shipper can
// pick it up later without code changes.
function emit(level, msg, meta) {
  const rec = { ts: new Date().toISOString(), level, msg };
  if (meta && typeof meta === 'object') Object.assign(rec, meta);
  // stderr for warn/error so an ops dashboard separates them naturally.
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(rec) + '\n');
}

export const logger = {
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
  debug: (msg, meta) => { if (process.env.ANCHOR_DEBUG === '1') emit('debug', msg, meta); },
};
