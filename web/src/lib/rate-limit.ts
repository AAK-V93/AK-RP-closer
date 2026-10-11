/**
 * Per-user limit kept in memory, so it never wakes the database.
 * It is per server instance: a soft guard against loops and abuse, not an exact quota.
 */
type Window = { start: number; count: number };

export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, Window>();
  return function take(key: string, now = Date.now()) {
    const current = hits.get(key);
    if (!current || now - current.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 5000) {
        for (const [k, w] of hits) if (now - w.start >= windowMs) hits.delete(k);
      }
      return { ok: true, retryAfterSec: 0 };
    }
    if (current.count >= limit) {
      return { ok: false, retryAfterSec: Math.ceil((current.start + windowMs - now) / 1000) };
    }
    current.count += 1;
    return { ok: true, retryAfterSec: 0 };
  };
}
