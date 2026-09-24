/**
 * In-memory rate limiting for vendor login / signup.
 * Locks an account key after too many failures within a time window.
 */

type Bucket = {
  count: number;
  windowStart: number;
  lockedUntil: number | null;
};

const buckets = new Map<string, Bucket>();

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_LOCK_MS = 15 * 60 * 1000; // lock 15 minutes

export const REGISTER_MAX_ATTEMPTS = 8;
export const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const REGISTER_LOCK_MS = 30 * 60 * 1000;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("cf-connecting-ip") || "unknown";
}

export function loginAttemptKey(shop: string, email: string, request: Request) {
  return `login:${shop}:${email}:${getClientIp(request)}`;
}

export function registerAttemptKey(request: Request) {
  return `register:${getClientIp(request)}`;
}

function getBucket(key: string): Bucket {
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: Bucket = { count: 0, windowStart: Date.now(), lockedUntil: null };
  buckets.set(key, created);
  return created;
}

function pruneIfStale(bucket: Bucket, windowMs: number) {
  if (Date.now() - bucket.windowStart > windowMs) {
    bucket.count = 0;
    bucket.windowStart = Date.now();
    bucket.lockedUntil = null;
  }
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number; message: string };

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): RateLimitResult {
  const bucket = getBucket(key);

  if (bucket.lockedUntil && bucket.lockedUntil > Date.now()) {
    const retryAfterSeconds = Math.ceil(
      (bucket.lockedUntil - Date.now()) / 1000,
    );
    return {
      allowed: false,
      retryAfterSeconds,
      message: `Too many attempts. Please wait ${Math.ceil(retryAfterSeconds / 60)} minute(s) and try again.`,
    };
  }

  if (bucket.lockedUntil && bucket.lockedUntil <= Date.now()) {
    bucket.lockedUntil = null;
    bucket.count = 0;
    bucket.windowStart = Date.now();
  }

  pruneIfStale(bucket, windowMs);

  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - bucket.count),
  };
}

export function recordFailedAttempt(
  key: string,
  maxAttempts: number,
  windowMs: number,
  lockMs: number,
): RateLimitResult {
  const bucket = getBucket(key);
  pruneIfStale(bucket, windowMs);
  bucket.count += 1;

  if (bucket.count >= maxAttempts) {
    bucket.lockedUntil = Date.now() + lockMs;
    const retryAfterSeconds = Math.ceil(lockMs / 1000);
    return {
      allowed: false,
      retryAfterSeconds,
      message: `Too many failed attempts. Your sign-in is locked for ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
    };
  }

  const remaining = maxAttempts - bucket.count;
  return {
    allowed: true,
    remaining,
  };
}

export function clearAttempts(key: string) {
  buckets.delete(key);
}

/** Reject cross-site form posts when Origin is present and does not match Host. */
export function assertSameOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    const originHost = new URL(origin).host;
    const host = request.headers.get("Host");
    if (host && originHost !== host) {
      return "This request looked unsafe and was blocked. Please try again from the login page.";
    }
  } catch {
    return "This request looked unsafe and was blocked.";
  }
  return null;
}
