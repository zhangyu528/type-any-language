#!/usr/bin/env node
// frontend/scripts/dev.mjs
//
// Self-healing entry point for `npm run dev`. Replaces the bare `next dev`
// in package.json so dev loop survives:
//   - fresh checkout (node_modules absent)
//   - lock hash drift (someone ran `npm install` outside of this script,
//     or edited package-lock.json by hand)
//
// What it does:
//   1. Run `npm run install` (install.mjs is hash-aware — skip when
//      node_modules + lock hash are healthy, ~50ms; only the first run
//      or after a lock change actually does npm install).
//   2. Spawn `next dev` with whatever extra args the operator passed
//      (`--port 3001` etc.). argv pass-through is verbatim.
//
// Why this is dev.mjs, not Next.js bare:
//   - Bare `next dev` will surface weird "missing dep" / hash mismatch
//     errors when node_modules is stale. Self-heal → operator doesn't
//     have to know about install.
//   - Same shape as docker-compose `depends_on: condition: healthy`:
//     dependency is guaranteed healthy before the real service starts.
//   - install.mjs stays single-purpose (just install). dev.mjs is the
//     orchestrator.
//
// Usage:
//   npm run dev                  # default port 3000
//   npm run dev -- --port 3001   # custom port
//
// Frontend dev / restart division of labor (post-dev.mjs):
//   - `npm run dev`         → self-heal install + start (this script)
//   - `npm run dev:restart` → force kill + port sweep + respawn
//     (restart.mjs; assumes install is already healthy, otherwise
//      run `npm run install` explicitly first)

import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');

// ─── 1. self-heal: ensure node_modules is healthy ─────────────────────────
console.log('[dev] ensuring node_modules (smart install)...');
// shell: true for Windows so Node resolves the npm -> npm.cmd shim
// (npm is a .cmd batch wrapper, not a native executable).
execFileSync('npm', ['run', 'install'], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true,
});

// ─── 2. forward to next dev with argv pass-through ────────────────────────
// argv[0] = node, argv[1] = this script, argv[2..] = operator's extras.
// npm run dev -- --port 3001 passes -- --port 3001 through, which node
// receives as separate argv entries (npm splits on -- itself).
const args = process.argv.slice(2);
const child = spawn('next', ['dev', ...args], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true,           // Windows: next is also a .cmd/.ps1 shim
  env: process.env,
});

// Propagate next dev's exit code so npm/CI sees the real status.
child.on('exit', (code, signal) => {
  if (signal) {
    // SIGINT/SIGTERM etc. — exit with 128+signo per shell convention.
    process.exit(128 + (typeof signal === 'string' ? 15 : 0));
  }
  process.exit(code ?? 0);
});

// Forward SIGINT (Ctrl+C) so the operator's keyboard shortcut reaches
// next dev. Without this, Ctrl+C in the parent kills only dev.mjs while
// next dev keeps running orphaned.
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));