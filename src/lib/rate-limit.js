/* In-memory sliding-window login throttle — defence-in-depth against credential
   brute force. After `max` failed logins for the same identifier inside
   `windowMs`, further attempts are refused until the oldest failure ages out; a
   successful login clears the counter immediately.

   State is a per-process Map, so on a multi-instance / serverless host it
   throttles per warm instance rather than fleet-wide — enough to blunt a naive
   attack without a new dependency. A global guarantee would back this with
   Redis or a database table; the interface here would not change. */

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function createLoginLimiter({ max = MAX_ATTEMPTS, windowMs = WINDOW_MS } = {}) {
  const fails = new Map(); // key -> number[] (timestamps of recent failures)

  // Prune expired failures for a key and return what remains.
  const recent = (key, now) => {
    const arr = (fails.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length) fails.set(key, arr);
    else fails.delete(key);
    return arr;
  };

  return {
    /** { blocked, remaining, retryAfterMs } for a key as of `now`. */
    status(key, now = Date.now()) {
      const arr = recent(key, now);
      const blocked = arr.length >= max;
      const retryAfterMs = blocked ? Math.max(0, windowMs - (now - arr[0])) : 0;
      return { blocked, remaining: Math.max(0, max - arr.length), retryAfterMs };
    },
    /** Record a failed attempt; returns the new status. */
    fail(key, now = Date.now()) {
      const arr = recent(key, now);
      arr.push(now);
      fails.set(key, arr);
      return this.status(key, now);
    },
    /** A successful login wipes the key's failure history. */
    succeed(key) {
      fails.delete(key);
    },
    /** Test/introspection helper — number of tracked keys. */
    _size() {
      return fails.size;
    },
  };
}

// Shared instance used by the auth layer.
export const loginLimiter = createLoginLimiter();
