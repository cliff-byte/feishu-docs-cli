/**
 * Stdout/stderr capture helper for command output testing.
 *
 * Replaces process.stdout.write and process.stderr.write with interceptors
 * that collect output chunks. Call restore() in afterEach to clean up.
 */

interface CapturedOutput {
  stdout(): string;
  stderr(): string;
  stdoutJson(): unknown;
  restore(): void;
}

/**
 * Capture process.stdout.write and process.stderr.write output.
 *
 * @returns Object with stdout(), stderr(), stdoutJson(), and restore() methods.
 */
export function captureOutput(): CapturedOutput {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    if (typeof chunk === "string") {
      stdoutChunks.push(chunk);
    } else {
      // Binary data from test runner protocol — pass through to original
      return origStdout(chunk, ...(args as []));
    }
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    if (typeof chunk === "string") {
      stderrChunks.push(chunk);
    } else {
      // Binary data from test runner protocol — pass through to original
      return origStderr(chunk, ...(args as []));
    }
    return true;
  }) as typeof process.stderr.write;

  return {
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
    stdoutJson: () => JSON.parse(stdoutChunks.join("")),
    restore: () => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    },
  };
}
