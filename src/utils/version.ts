/**
 * Version display and update check utilities.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const PACKAGE_NAME = "feishu-docs-cli";
const CONFIG_DIR = join(homedir(), ".feishu-docs");
const UPDATE_CHECK_FILE = join(CONFIG_DIR, ".update-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface UpdateCheckState {
  lastCheck: number;
  latestVersion?: string;
}

/**
 * Read the local package version from package.json.
 */
export function getLocalVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../../package.json") as { version: string };
  return pkg.version;
}

/**
 * Fetch the latest version from npm registry.
 */
async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Load the update check state from disk.
 */
async function loadCheckState(): Promise<UpdateCheckState> {
  try {
    const raw = await readFile(UPDATE_CHECK_FILE, "utf-8");
    return JSON.parse(raw) as UpdateCheckState;
  } catch {
    return { lastCheck: 0 };
  }
}

/**
 * Save the update check state to disk.
 */
async function saveCheckState(state: UpdateCheckState): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(UPDATE_CHECK_FILE, JSON.stringify(state));
}

/**
 * Compare two semver strings. Returns:
 *  1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[-.]/).map((s) => {
    const n = Number(s);
    return isNaN(n) ? s : n;
  });
  const pb = b.replace(/^v/, "").split(/[-.]/).map((s) => {
    const n = Number(s);
    return isNaN(n) ? s : n;
  });
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    // A pre-release tag (string) is less than a release (number absent)
    if (typeof va === "string" && typeof vb === "number") return -1;
    if (typeof va === "number" && typeof vb === "string") return 1;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Check for updates and print a notice if a newer version is available.
 * This is non-blocking and never throws — update check failures are silent.
 */
export async function checkForUpdates(): Promise<void> {
  try {
    const state = await loadCheckState();
    const now = Date.now();

    // Skip if checked recently
    if (now - state.lastCheck < CHECK_INTERVAL_MS) {
      // Still show cached notice if a newer version was found last time
      if (state.latestVersion) {
        const local = getLocalVersion();
        if (compareSemver(state.latestVersion, local) > 0) {
          printUpdateNotice(local, state.latestVersion);
        }
      }
      return;
    }

    // Fetch latest version from npm (with timeout)
    const latest = await fetchLatestVersion();
    const newState: UpdateCheckState = {
      lastCheck: now,
      latestVersion: latest || undefined,
    };
    await saveCheckState(newState);

    if (latest) {
      const local = getLocalVersion();
      if (compareSemver(latest, local) > 0) {
        printUpdateNotice(local, latest);
      }
    }
  } catch {
    // Never block CLI usage due to update check failure
  }
}

function printUpdateNotice(current: string, latest: string): void {
  process.stderr.write(
    `feishu-docs: 发现新版本 ${latest}（当前 ${current}），运行 npm update -g ${PACKAGE_NAME} 更新\n`,
  );
}
