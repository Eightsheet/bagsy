import type { Context, MiddlewareHandler, Next } from "hono";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/** Best-effort client IP behind Railway / proxies. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip")?.trim() || "unknown";
}

function take(key: string, windowMs: number, max: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

/** Periodic cleanup so the in-memory map does not grow forever. */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  /** Key prefix, e.g. "device-code" */
  name: string;
  /** Extra key material (user id, token prefix). Defaults to client IP. */
  key?: (c: Context) => string;
}): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const id = opts.key?.(c) ?? clientIp(c);
    const result = take(`${opts.name}:${id}`, opts.windowMs, opts.max);
    if (!result.ok) {
      c.header("Retry-After", String(result.retryAfterSec));
      if (c.req.path.startsWith("/v1/")) {
        return c.json(
          {
            error: "rate_limited",
            message: "Too many requests. Try again shortly.",
            retryAfterSec: result.retryAfterSec,
          },
          429,
        );
      }
      return c.text("Too many requests. Try again shortly.", 429);
    }
    await next();
  };
}
