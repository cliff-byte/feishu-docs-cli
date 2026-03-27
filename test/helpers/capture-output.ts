/**
 * Capture stdout/stderr output from command handlers.
 *
 * Replaces process.stdout.write and process.stderr.write with buffers.
 * Only captures string writes (application output). Binary writes from
 * the Node.js test runner (TAP protocol) are passed through to the
 * original write function to avoid interference.
 *
 * Call restore() in afterEach to guarantee cleanup.
 */

interface CapturedOutput {
  /** Accumulated stdout content. */
  stdout: () => string;
  /** Accumulated stderr content. */
  stderr: () => string;
  /** Parse stdout as JSON. */
  stdoutJson: () => Record<string, unknown>;
  /** Restore original write functions. */
  restore: () => void;
}

/**
 * Intercept process.stdout.write and process.stderr.write.
 *
 * @returns Object with stdout(), stderr(), stdoutJson(), and restore().
 */
export function captureOutput(): CapturedOutput {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean => {
    // Only capture string writes (application output).
    // Pass through binary writes (test runner TAP protocol) untouched.
    if (typeof chunk === "string") {
      stdoutChunks.push(chunk);
      const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
      if (callback) callback();
      return true;
    }
    return originalStdoutWrite(chunk, encodingOrCb as BufferEncoding, cb);
  }) as typeof process.stdout.write;

  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean => {
    if (typeof chunk === "string") {
      stderrChunks.push(chunk);
      const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
      if (callback) callback();
      return true;
    }
    return originalStderrWrite(chunk, encodingOrCb as BufferEncoding, cb);
  }) as typeof process.stderr.write;

  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    stdoutJson: () => JSON.parse(stdoutChunks.join("")) as Record<string, unknown>,
    restore: () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}
