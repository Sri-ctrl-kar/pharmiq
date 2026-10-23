/**
 * Fixed-window, in-memory rate limiter. Per server instance only: adequate for a demo,
 * not for multi-instance production (use a shared store such as Redis there).
 */
export function createRateLimiter({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}) {
  const windows = new Map<string, { start: number; count: number }>();

  return function check(key: string, now: number = Date.now()) {
    if (windows.size > 10_000) {
      for (const [k, w] of windows)
        if (now - w.start >= windowMs) windows.delete(k);
    }
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      windows.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((current.start + windowMs - now) / 1000),
      };
    }
    current.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
