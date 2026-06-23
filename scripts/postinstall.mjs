#!/usr/bin/env node
/**
 * npm postinstall hook — thin launcher.
 *
 * Syncs the packaged SKILL.md to the Claude-side skill directories after an
 * install or upgrade. Delegates to the compiled `dist/utils/skill-sync.js` so
 * the logic lives in exactly one place.
 *
 * This script must NEVER fail the install:
 * - In a published package `dist/` is always present (prepublishOnly builds it).
 * - In a fresh dev checkout `dist/` may not be built yet — the dynamic import
 *   throws and we silently skip; the runtime fallback in cli.ts covers it later.
 * - Any other error (permissions, no HOME, CI) is swallowed.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

try {
  const mod = await import(resolve(here, "../dist/utils/skill-sync.js"));
  await mod.syncSkill();
} catch {
  // Never block `npm install` because of skill sync.
}

process.exit(0);
