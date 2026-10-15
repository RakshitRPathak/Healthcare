import { AppError } from './errors';

/** Fixed-window in-memory throttle. Expired windows are swept so the map cannot grow without bound.
 *  Per-process: use a shared store (Redis) if you run several API instances. */
export function createThrottle(limit: number, windowMs: number, code = 'TOO_MANY_ATTEMPTS', message = 'Too many attempts, try again later') {
  const hits = new Map<string, { n: number; reset: number }>();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, Math.min(windowMs, 60_000));
  sweep.unref();
  return {
    hit(key: string) {
      const now = Date.now(); const e = hits.get(key);
      if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return; }
      if (++e.n > limit) throw new AppError(429, code, message);
    },
    get size() { return hits.size; },
    stop() { clearInterval(sweep); },
  };
}
