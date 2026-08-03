#!/usr/bin/env node
// frontend/scripts/install.mjs
//
// Smart `npm install`. Replaces ops/dev/setup.sh::native_setup_node.
//
// Why "smart install":
//   - Idempotent — if `node_modules/` exists AND package-lock.json
//     sha256 matches `.package-lock.sha256`, skip (zero-cost re-run).
//   - Hash mismatch / missing node_modules → run `npm install` + write
//     the new hash.
//   - Cross-platform: uses node:crypto + node:fs + node:child_process.
//     The sh version had to special-case GNU vs BSD `sha256sum` /
//     `awk` / `tr` and trip over Git Bash path translation; Node 22+
//     does it all in 30 lines and behaves identically on macOS,
//     Linux, and Windows.
//
// Note on the script name `install`:
//   - npm's own built-in `npm install` (no `run`) is the literal
//     package-install command. Using `npm run install` (with `run`)
//     routes to this script via package.json — no conflict, but the
//     naming is deliberate to discourage the bare `npm install` form
//     (which would skip the hash check and silently re-install).
//
// Usage:
//   npm run install                  # from repo root
//   cd frontend && npm run install   # from frontend/
//   node frontend/scripts/install.mjs

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');     // frontend/scripts -> frontend/
const LOCK = path.join(FRONTEND_DIR, 'package-lock.json');
const HASH_FILE = path.join(FRONTEND_DIR, '.package-lock.sha256');
const NM = path.join(FRONTEND_DIR, 'node_modules');

const log = (...a) => console.log('[install]', ...a);

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

if (!existsSync(LOCK)) {
  console.error('[install] [ERR] package-lock.json not found at', LOCK);
  process.exit(1);
}

const currentHash = sha256(LOCK);
const priorHash = existsSync(HASH_FILE)
  ? readFileSync(HASH_FILE, 'utf8').trim()
  : '';

if (existsSync(NM) && currentHash === priorHash) {
  log('node_modules exists + lock hash match — skip');
  process.exit(0);
}

log('running npm install (no-audit, no-fund)...');
// shell: true so Node on Windows resolves the `npm` -> `npm.cmd` shim
// automatically (npm is a .cmd batch wrapper, not a native executable —
// direct execFileSync('npm', ...) fails with ENOENT otherwise). On
// Unix, npm is a real binary so shell:true is a no-op semantically.
execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true,
});
writeFileSync(HASH_FILE, currentHash);
log('installed; wrote', path.basename(HASH_FILE));