// SERVER-ONLY. Small helpers for running bounded-concurrency work inside a
// serverless function that has a hard wall-clock limit.
//
// Why these exist: the poll and discovery jobs used plain `for … await`
// loops, so 200 bills meant 200 network round-trips strictly one after
// another - roughly 60-80 seconds of mostly-idle waiting. Vercel kills the
// function long before that finishes, so runs were being truncated
// mid-flight and whatever ran last (topic discovery) effectively never ran
// at all.
//
// Running them concurrently in small groups turns that same work into a few
// seconds. The concurrency limit matters: unbounded Promise.all over 200
// items would fire 200 simultaneous requests at congress.gov, which is a
// good way to get rate-limited or have the runtime run out of sockets.

/** Runs `fn` over `items`, at most `limit` at a time, preserving input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * A wall-clock budget. Long jobs check `expired()` between chunks of work and
 * stop cleanly instead of being killed mid-write by the platform.
 *
 * Both jobs that use this are resumable by design - the poller picks up
 * whatever is still due on the next run, and discovery rotates which owners
 * it starts with - so stopping early costs nothing but a short delay.
 */
export function deadline(budgetMs: number) {
  const start = Date.now();
  return {
    expired: () => Date.now() - start > budgetMs,
    elapsedMs: () => Date.now() - start,
    remainingMs: () => Math.max(0, budgetMs - (Date.now() - start)),
  };
}

/** Splits an array into fixed-size chunks. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Rotates an array by a day-derived offset so a job that can't get through
 * every owner in one run doesn't always favour the same few. No schema
 * change needed - the rotation is derived from the date rather than stored.
 */
export function rotateByDay<T>(items: T[]): T[] {
  if (items.length < 2) return items;
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const offset = dayIndex % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
