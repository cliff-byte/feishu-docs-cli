/**
 * Zero-dependency concurrency limiter (pLimit-style).
 * Limits the number of concurrently executing async functions.
 */

/**
 * Create a concurrency limiter that allows at most `concurrency`
 * async functions to execute simultaneously.
 *
 * @param concurrency Maximum number of concurrent executions (positive integer)
 * @returns A limit function that wraps async functions with concurrency control
 */
export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Expected concurrency to be a positive integer");
  }

  let active = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}
