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

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
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
