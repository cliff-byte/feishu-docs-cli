/**
 * Skill sync utilities.
 *
 * Keeps the Claude-side copies of the feishu-docs skill in step with the
 * `skills/feishu-docs/SKILL.md` that ships inside this package. Used by three
 * call sites: the npm `postinstall` hook, the `install-skill` command, and a
 * non-blocking runtime fallback in `cli.ts`.
 *
 * Every operation is fault-tolerant: a failure on one target never aborts the
 * others and the function never throws — syncing the skill must not block an
 * install or a CLI invocation.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Source SKILL.md inside the package (published via `files: ["skills/"]`). */
const SKILL_SOURCE = resolve(__dirname, "../../skills/feishu-docs/SKILL.md");

/** Opt-out switch for CI / special environments. */
const DISABLE_ENV = "FEISHU_DOCS_NO_SKILL_SYNC";

interface SkillTarget {
  /** Framework skills directory that must exist before we sync (auto mode). */
  parentDir: string;
  /** Full path to the SKILL.md copy we manage. */
  filePath: string;
  /**
   * Canonical targets (Claude Code's standard location) are created on demand
   * in `force` mode. Opportunistic targets are only ever updated when their
   * framework is already installed.
   */
  canonical: boolean;
}

export interface SkillSyncResult {
  /** Targets written (new copy or content change). */
  synced: string[];
  /** Targets already identical to the source. */
  unchanged: string[];
  /** Targets skipped because the framework's skills dir is absent. */
  absent: string[];
  /** Targets that errored (permission, read-only, etc.). */
  failed: string[];
}

export interface SkillSyncOptions {
  /** Override the home directory (tests). */
  home?: string;
  /** Override the source SKILL.md path (tests). */
  sourcePath?: string;
  /**
   * When true, canonical targets are created even if their parent skills
   * directory does not exist yet. Used by the explicit `install-skill` command.
   */
  force?: boolean;
}

function getTargets(home: string): SkillTarget[] {
  return [
    {
      parentDir: join(home, ".claude", "skills"),
      filePath: join(home, ".claude", "skills", "feishu-docs", "SKILL.md"),
      canonical: true,
    },
    {
      parentDir: join(home, ".agents", "skills"),
      filePath: join(home, ".agents", "skills", "feishu-docs", "SKILL.md"),
      canonical: false,
    },
  ];
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Sync the packaged SKILL.md to the Claude-side skill directories.
 * Never throws. Returns a per-target breakdown of what happened.
 */
export async function syncSkill(
  options: SkillSyncOptions = {},
): Promise<SkillSyncResult> {
  const result: SkillSyncResult = {
    synced: [],
    unchanged: [],
    absent: [],
    failed: [],
  };

  if (process.env[DISABLE_ENV] === "1") {
    return result;
  }

  const home = options.home ?? homedir();
  const sourcePath = options.sourcePath ?? SKILL_SOURCE;
  const force = options.force === true;

  let source: string;
  try {
    source = await readFile(sourcePath, "utf-8");
  } catch {
    // No source SKILL.md (should not happen in a published package).
    return result;
  }

  for (const target of getTargets(home)) {
    try {
      const ensure = force && target.canonical;
      if (!ensure && !(await dirExists(target.parentDir))) {
        result.absent.push(target.filePath);
        continue;
      }

      const current = await readFile(target.filePath, "utf-8").catch(() => null);
      if (current === source) {
        result.unchanged.push(target.filePath);
        continue;
      }

      await mkdir(dirname(target.filePath), { recursive: true });
      await writeFile(target.filePath, source, "utf-8");
      result.synced.push(target.filePath);
    } catch {
      // A single target's failure must never abort the others or throw.
      result.failed.push(target.filePath);
    }
  }

  return result;
}
