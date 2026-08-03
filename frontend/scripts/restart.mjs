#!/usr/bin/env node
// frontend/scripts/restart.mjs
//
// Force-restart the frontend dev server. Replaces ops/dev/restart_frontend_dev.sh.
//
// Scope (post-dev.mjs):
//   - This script handles the DEV-SERVER-PROCESS layer only.
//     Install-layer health is dev.mjs's job (it auto-runs `npm run
//     install` before spawning next dev). Calling this script assumes
//     node_modules is healthy; if not, run `npm run install` first.
//   - Why a separate script (vs. just `kill && npm run dev`):
//       * pid file kill alone misses orphan processes whose pid file
//         was lost or wrong (on Windows Git Bash, MSYS fake-PID from
//         `kill -0` always returns success — see ops/dev/native.sh:90-110)
//       * next dev forks a shim that exec's the real worker; the
//         shim's pid is what's in pid file, but the listener is the
//         worker. We sweep :$FRONTEND_PORT for any LISTENer and kill it.
//       * Without the sweep, a stale listener binds :$FRONTEND_PORT and
//         the new spawn fails with EADDRINUSE (or WinError 10048).
//
// Workflow:
//   1. Kill the pid in .native-pids/frontend.pid (graceful SIGTERM,
//      then SIGKILL fallback).
//   2. Sweep :$FRONTEND_PORT for any leftover LISTEN-owning pid via
//      netstat (cross-platform) and taskkill /F on Windows. Drain
//      until port is free (3s budget).
//   3. Spawn `npm run dev -- --port $FRONTEND_PORT`. dev.mjs handles
//      install health; this script just deals with the process.
//
// When to use this vs. dev.mjs:
//   - npm run dev         → first start / after package.json change
//                           (dev.mjs self-heals install + spawns next dev)
//   - npm run dev:restart → after editing next.config.js, when Fast
//                           Refresh is wedged, or port is stuck (this script)
//
// Usage:
//   FRONTEND_PORT=3001 node scripts/restart.mjs
//   npm run dev:restart

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(FRONTEND_DIR, '..');
const PID_FILE = path.join(REPO_ROOT, '.native-pids', 'frontend.pid');
const LOG_FILE = path.join(REPO_ROOT, '.native-logs', 'frontend.log');
const PORT = process.env.FRONTEND_PORT || '3000';

const log = (...a) => console.log('[frontend:restart]', ...a);
const warn = (...a) => console.warn('[frontend:restart][warn]', ...a);
const err = (...a) => console.error('[frontend:restart][err]', ...a);

// ─── platform detection ───────────────────────────────────────────────────
const isWindows = process.platform === 'win32';

// ─── pid-alive probe (real OS pid, not MSYS fake-PID) ─────────────────────
function pidAlive(pid) {
  if (!pid || !/^\d+$/.test(pid)) return false;
  if (isWindows) {
    try {
      const out = execFileSync(
        'tasklist',
        ['/NH', '/FO', 'CSV', '/FI', `PID eq ${pid}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return /^\s*"[^"]+","\d+"/.test(out);
    } catch {
      return false;
    }
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function killPid(pid, signal = 'SIGTERM') {
  if (!pidAlive(pid)) return false;
  try {
    if (isWindows) {
      execFileSync('taskkill', ['/PID', pid, '/T'], { stdio: 'ignore' });
    } else {
      process.kill(Number(pid), signal);
    }
    return true;
  } catch (e) {
    warn('kill', pid, 'failed:', e.message);
    return false;
  }
}

// ─── port LISTENers sweep ─────────────────────────────────────────────────
function listenersOnPort(port) {
  try {
    const out = execFileSync(
      isWindows ? 'netstat.exe' : 'netstat',
      ['-ano'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const pids = new Set();
    const portRe = new RegExp(`(?:^|\\s)0\\.0\\.0\\.0:${port}\\s.*?(?:LISTEN(?:ING)?)\\s+(\\d+)\\s*$`, 'im');
    const portRe6 = new RegExp(`(?:^|\\s)\\[?::\\]?:${port}\\s.*?(?:LISTEN(?:ING)?)\\s+(\\d+)\\s*$`, 'im');
    for (const line of out.split(/\r?\n/)) {
      let m = line.match(portRe) || line.match(portRe6);
      if (m) pids.add(m[1]);
    }
    return [...pids].filter((p) => p && p !== '0');
  } catch (e) {
    warn('netstat failed:', e.message);
    return [];
  }
}

function sweepPort(port) {
  const pids = listenersOnPort(port);
  if (pids.length === 0) return 0;
  log(`:$port has ${pids.length} leftover LISTENer(s) — sweeping`);
  let killed = 0;
  for (const pid of pids) {
    if (isWindows) {
      try {
        execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { stdio: 'ignore' });
        killed++;
      } catch (e) {
        warn('taskkill', pid, 'failed:', e.message);
      }
    } else if (killPid(pid, 'SIGKILL')) {
      killed++;
    }
  }
  return killed;
}

async function drainPort(port) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (listenersOnPort(port).length === 0) return true;
    sweepPort(port);
    await new Promise((r) => setTimeout(r, 250));
  }
  return listenersOnPort(port).length === 0;
}

// ─── Step 1: kill pid file ────────────────────────────────────────────────
if (existsSync(PID_FILE)) {
  const pid = readFileSync(PID_FILE, 'utf8').trim();
  if (pid && pidAlive(pid)) {
    log(`killing pid file PID ${pid}`);
    killPid(pid, 'SIGTERM');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && pidAlive(pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (pidAlive(pid)) {
      log(`pid ${pid} did not exit gracefully, sending SIGKILL`);
      killPid(pid, 'SIGKILL');
    }
  } else if (pid) {
    log(`pid file PID ${pid} is stale (already dead), cleaning up`);
  }
  try {
    require('node:fs').unlinkSync(PID_FILE);
  } catch {
    // best-effort
  }
}

// ─── Step 2: sweep :$PORT ────────────────────────────────────────────────
if (!(await drainPort(PORT))) {
  err(`:$PORT still LISTEN after sweep — refusing to start`);
  err('  (kernel may be holding an orphaned socket; reboot or wait for TIME_WAIT)');
  process.exit(1);
}

// ─── Step 3: spawn fresh npm run dev ─────────────────────────────────────
mkdirSafe(LOG_FILE);
const out = openSync(LOG_FILE, 'a');
const errFd = openSync(LOG_FILE, 'a');

log(`starting npm run dev -- --port ${PORT}`);
const child = spawn(
  'npm',
  ['run', 'dev', '--', '--port', PORT],
  {
    cwd: FRONTEND_DIR,
    env: { ...process.env },
    stdio: ['ignore', out, errFd],
    shell: isWindows,
    detached: true,
  },
);
child.unref();

await new Promise((r) => setTimeout(r, 800));
const realPid = listenersOnPort(PORT)[0] || String(child.pid || '');
if (realPid) {
  writeFileSync(PID_FILE, realPid + '\n');
  log(`pid file written: ${realPid}`);
} else {
  warn('could not resolve real pid from port listener; pid file empty');
}

log(`frontend dev restarted on :${PORT}`);
log(`  logs: tail -f ${LOG_FILE}`);
process.exit(0);

function mkdirSafe(p) {
  const d = path.dirname(p);
  if (!existsSync(d)) {
    require('node:fs').mkdirSync(d, { recursive: true });
  }
}