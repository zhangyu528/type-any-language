#!/usr/bin/env node
// frontend/scripts/preflight.mjs
//
// Read-only self-check for the frontend dev loop. Exits 0 if all checks
// pass, 1 if any fail. Replaces the inline `frontend/node_modules` +
// node version + npm checks that used to live in ops/dev/doctor.sh
// and ops/dev/native.sh::cmd_preflight.
//
// Why a frontend-owned script (vs. inline in ops/dev/doctor.sh):
//   - frontend knows its own contract: what node version it needs,
//     what package.json scripts it expects, what node_modules must
//     look like. Ops shouldn't hardcode these.
//   - `npm run preflight` works the same on macOS / Linux / Windows —
//     no sh quoting pain (sed -i / awk / tasklist).
//
// Checks:
//   1. node ≥ 20 in PATH
//   2. npm in PATH
//   3. package.json present + parseable
//   4. package.json has scripts: dev / build / start / lint / install / dev:restart / preflight
//   5. node_modules present (or hash mismatch warning if .package-lock.sha256 exists)
//   6. next.config.js present
//   7. scripts/install.mjs, scripts/restart.mjs, scripts/preflight.mjs all present
//
// Usage:
//   node scripts/preflight.mjs
//   npm run preflight
//   make dev-doctor  # (which will proxy to this)

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');

const log = (...a) => console.log('[frontend:preflight]', ...a);
const ok = (...a) => console.log('[frontend:preflight][ok]', ...a);
const warn = (...a) => console.warn('[frontend:preflight][warn]', ...a);
const err = (...a) => console.error('[frontend:preflight][err]', ...a);

let failed = 0;

// ─── 1. node ≥ 20 ─────────────────────────────────────────────────────────
try {
  const v = execFileSync('node', ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '');
  const major = parseInt(v.split('.')[0], 10);
  if (major >= 20) ok(`node ${v}`);
  else { err(`node ${v} (need ≥ 20)`); failed++; }
} catch (e) {
  err(`node not in PATH: ${e.message}`);
  failed++;
}

// ─── 2. npm ────────────────────────────────────────────────────────────────
try {
  const v = execFileSync('npm', ['--version'], { encoding: 'utf8', shell: true }).trim();
  ok(`npm ${v}`);
} catch (e) {
  err(`npm not in PATH: ${e.message}`);
  failed++;
}

// ─── 3. package.json present + parseable ───────────────────────────────────
const pkgPath = path.join(FRONTEND_DIR, 'package.json');
let pkg = null;
if (!existsSync(pkgPath)) {
  err(`package.json missing at ${pkgPath}`);
  failed++;
} else {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    ok('package.json parseable');
  } catch (e) {
    err(`package.json parse error: ${e.message}`);
    failed++;
  }
}

// ─── 4. required scripts ───────────────────────────────────────────────────
const REQUIRED_SCRIPTS = ['dev', 'build', 'start', 'lint', 'install', 'dev:restart', 'preflight'];
if (pkg) {
  const missing = REQUIRED_SCRIPTS.filter((s) => !pkg.scripts?.[s]);
  if (missing.length === 0) {
    ok(`package.json scripts: ${REQUIRED_SCRIPTS.join(', ')}`);
  } else {
    err(`package.json missing scripts: ${missing.join(', ')}`);
    failed++;
  }
}

// ─── 5. node_modules present + hash sanity ────────────────────────────────
const nm = path.join(FRONTEND_DIR, 'node_modules');
const lock = path.join(FRONTEND_DIR, 'package-lock.json');
const hashFile = path.join(FRONTEND_DIR, '.package-lock.sha256');

if (!existsSync(nm)) {
  err('node_modules missing — run: npm run install');
  failed++;
} else if (existsSync(lock) && existsSync(hashFile)) {
  const { createHash } = await import('node:crypto');
  const cur = createHash('sha256').update(readFileSync(lock)).digest('hex');
  const stored = readFileSync(hashFile, 'utf8').trim();
  if (cur === stored) {
    ok('node_modules present + lock hash match');
  } else {
    warn('node_modules present but lock hash mismatch — run: npm run install');
  }
} else {
  ok('node_modules present (no hash file yet — first run after install is fine)');
}

// ─── 6. next.config.js present ────────────────────────────────────────────
const nextConfig = path.join(FRONTEND_DIR, 'next.config.js');
if (existsSync(nextConfig)) {
  ok('next.config.js present');
} else {
  err(`next.config.js missing at ${nextConfig}`);
  failed++;
}

// ─── 7. scripts/ self-consistency ─────────────────────────────────────────
const requiredScripts = ['install.mjs', 'dev.mjs', 'build.mjs', 'restart.mjs', 'preflight.mjs'];
for (const name of requiredScripts) {
  const p = path.join(HERE, name);
  if (existsSync(p)) {
    ok(`scripts/${name} present`);
  } else {
    err(`scripts/${name} missing`);
    failed++;
  }
}

// ─── summary ──────────────────────────────────────────────────────────────
console.log('');
if (failed === 0) {
  ok('all preflight checks passed');
  process.exit(0);
} else {
  err(`${failed} preflight check(s) failed`);
  process.exit(1);
}