// Ported from Ryhti/Core/Concurrency/ConcurrencyLimitedBatcher.swift.
// The server declares a per-IP concurrent-request cap (X-Concurrent-Limit-ip: 12,
// verified live by the iOS app's research). The default here (8) sits deliberately
// below that, leaving headroom. Unlike the Swift version this feeds a continuous
// pool rather than fixed chunks, so one slow request can't stall a whole chunk.

/**
 * Runs async operations at a bounded concurrency, preserving input order.
 *
 * An operation that throws yields null in its slot rather than rejecting the
 * whole batch — one failed bucket must never blank the dashboard. But the
 * errors are kept and returned alongside the results, so the caller can still
 * tell "one bucket failed" apart from "every request failed", which otherwise
 * renders identically to "this filter genuinely matches nothing".
 *
 * @param {Array<() => Promise<any>>} operations
 * @param {object} [options]
 * @param {number} [options.maxConcurrency=8]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{results: any[], errors: Array<Error|null>, failureCount: number}>}
 */
export async function runLimited(operations, options = {}) {
  const { maxConcurrency = 8, onProgress, signal } = options;
  const results = new Array(operations.length).fill(null);
  const errors = new Array(operations.length).fill(null);
  let next = 0;
  let done = 0;
  let failureCount = 0;

  async function worker() {
    while (true) {
      if (signal?.aborted) return;
      const index = next++;
      if (index >= operations.length) return;
      try {
        results[index] = await operations[index]();
      } catch (error) {
        // An abort is a caller-initiated cancellation, not a data failure —
        // it must not count toward failureCount or it would surface as an error.
        if (error?.name === "AbortError") throw error;
        results[index] = null;
        errors[index] = error;
        failureCount += 1;
      }
      done += 1;
      onProgress?.(done, operations.length);
    }
  }

  const workerCount = Math.min(maxConcurrency, operations.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { results, errors, failureCount };
}
