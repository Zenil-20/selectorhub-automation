// Normalise a URL into a route pattern so captures across page-views with
// different parameters group correctly. /users/12345/orders/abc-def
//   →   /users/:id/orders/:id
// Pure, deterministic, no I/O — straight to test it.

const SEG_NUMERIC = /^\d+$/;
const SEG_HEX = /^[0-9a-f]{8,}$/i;
const SEG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEG_SLUG_WITH_ID = /[-_][0-9a-f]{6,}$/i;
const SEG_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normaliseSegment(seg) {
  if (!seg) return seg;
  if (SEG_NUMERIC.test(seg)) return ':id';
  if (SEG_UUID.test(seg)) return ':uuid';
  if (SEG_HEX.test(seg)) return ':hash';
  if (SEG_DATE.test(seg)) return ':date';
  if (SEG_SLUG_WITH_ID.test(seg)) return seg.replace(/[-_][0-9a-f]{6,}$/i, '-:id');
  return seg;
}

export function routePattern(rawUrl) {
  if (!rawUrl) return '/';
  let pathname;
  try {
    const u = new URL(rawUrl);
    pathname = u.pathname || '/';
  } catch (_) {
    // Not a parseable URL — treat as raw path.
    pathname = rawUrl.split('?')[0].split('#')[0];
    if (!pathname.startsWith('/')) pathname = '/' + pathname;
  }
  const segs = pathname.split('/').map(normaliseSegment);
  const out = segs.join('/');
  return out || '/';
}
