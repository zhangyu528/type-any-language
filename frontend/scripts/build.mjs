#!/usr/bin/env node
// frontend/scripts/build.mjs
//
// Self-healing entry point for `npm run build`. Replaces the bare
// `NEXT_DIST_DIR=.next-build next build` in package.json so prod builds
// survive:
//   - fresh checkout (node_modules absent) — dev.mjs's job is dev loop,
//     but build runs in CI / one-off contexts where dev.mjs isn't invoked
//   - lock hash drift — stale node_modules silently uses wrong deps;
//     build self-heal so prod image is built against current lock
//
// What it does:
//   1. Run `npm run install` (install.mjs is hash-aware — skip when
//      node_modules + lock hash are healthy, ~50ms; only first run
//      or after lock change actually installs).
//   2. Spawn `next build` with NEXT_DIST_DIR=.next-build (matches the
//      pre-refactor behavior so prod / staging builds don't pollute
//      the dev server's `.next/`). Operator can override via env.
//   3. argv pass-through for next build flags.
//
// Why this matters more than dev.mjs:
//   - Dev loop failure is recoverable (operator fixes + rerun).
//   - Build failure → prod image bakes wrong deps → ship to prod →
//     runtime breakage. Self-heal at the build entry point catches
//     stale deps before they get baked.
//
// Scope vs dev.mjs / dev:restart:
//   - npm run dev          → install + start dev server (dev.mjs)
//   - npm run build        → install + prod build (this script)
//   - npm run dev:restart  → force restart dev server (restart.mjs)
//
// Usage:
//   npm run build                   # default NEXT_DIST_DIR=.next-build
//   NEXT_DIST_DIR=other npm run build   # override (rare)

import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');
const DEFAULT_DIST_DIR = '.next-build';  // match pre-refactor behavior

// ─── 1. self-heal: ensure node_modules is healthy ─────────────────────────
console.log('[build] ensuring node_modules (smart install)...');
// shell: true for Windows so Node resolves the npm -> npm.cmd shim
// (npm is a .cmd batch wrapper, not a native executable).
execFileSync('npm', ['run', 'install'], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true,
});

// ─── 2. forward to next build with argv pass-through ──────────────────────
// argv[0] = node, argv[1] = this script, argv[2..] = operator's extras.
// npm run build -- --debug passes -- --debug through, which node
// receives as separate argv entries (npm splits on -- itself).
const args = process.argv.slice(2);
const child = spawn('next', ['build', ...args], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true,           // Windows: next is also a .cmd/.ps1 shim
  env: {
    ...process.env,
    // Default to .next-build so dev's .next/ isn't polluted by prod builds.
    // Operator can still override by setting NEXT_DIST_DIR in shell env
    // BEFORE npm run build (process.env takes precedence over our default).
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || DEFAULT_DIST_DIR,
  },
});

// Propagate next build's exit code so npm/CI sees the real status.
child.on('exit', (code, signal) => {
  if (signal) {
    // SIGINT/SIGTERM etc. — exit with 128+signo per shell convention.
    process.exit(128 + (typeof signal === 'string' ? 15 : 0));
  }
  process.exit(code ?? 0);
});

// Forward SIGINT (Ctrl+C) so the operator's keyboard shortcut reaches
// next build. Without this, Ctrl+C in the parent kills only build.mjs
// while next build keeps running.
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));