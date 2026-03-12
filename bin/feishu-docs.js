#!/usr/bin/env node

import { run } from '../src/cli.js';

run(process.argv.slice(2)).catch(err => {
  process.stderr.write(`feishu-docs: fatal: ${err.message}\n`);
  process.exit(err.exitCode ?? 1);
});
