export type RetryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/**
 * Executes fn up to maxRetries+1 times with configurable delays between attempts.
 * Returns { ok: true, value } on first success, { ok: false, error } after all attempts fail.
 * Exported for unit testing without mocking internal state.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delayMs: readonly number[],
  onRetry?: (err: unknown, attempt: number) => void,
): Promise<RetryResult<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        onRetry?.(err, attempt + 1);
        await new Promise<void>(r => setTimeout(r, delayMs[attempt] ?? 1000));
      }
    }
  }
  return { ok: false, error: lastError };
}
