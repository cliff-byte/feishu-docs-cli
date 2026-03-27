/**
 * Output capture helper for testing commands that write to stdout/stderr.
 *
 * Temporarily replaces process.stdout.write and process.stderr.write
 * to collect output for assertions. Always call restore() in afterEach
 * or a finally block.
 */

interface CapturedOutput {
  /** Return all captured stdout as a single string. */
  stdout: () => string;
  /** Return all captured stderr as a single string. */
  stderr: () => string;
  /** Parse captured stdout as JSON (first complete line). */
  stdoutJson: () => unknown;
  /** Restore original stdout/stderr writers. */
  restore: () => void;
}

/**
 * Capture process.stdout.write and process.stderr.write output.
 *
 * @returns Object with stdout(), stderr(), stdoutJson(), and restore() methods.
 */
export function captureOutput(): CapturedOutput {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  process.stdout.write = ((
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ): boolean => {
    const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    stdoutChunks.push(str);
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((
    chunk: string | Uint8Array,
    ...rest: unknown[]
  ): boolean => {
    const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    stderrChunks.push(str);
    return true;
  }) as typeof process.stderr.write;

  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    stdoutJson: () => JSON.parse(stdoutChunks.join("")),
    restore: () => {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
  };
}
