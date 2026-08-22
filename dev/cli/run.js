#!/usr/bin/env node
// dev/cli/run.js — foreground dev loop multiplexer.
//
// Spawns backend (uvicorn --reload) + frontend (next dev), prefixes each
// line with service name + color, forwards Ctrl+C to both children,
// optionally kills siblings on first crash.
//
// Usage:
//   bash dev/dev run                       # both services (recommended)
//   bash dev/dev run backend               # backend only
//   bash dev/dev run frontend              # frontend only
//   bash dev/dev run --no-color
//   bash dev/dev run --kill-others=false
//   bash dev/dev run --help
//
// Exit codes:
//   0  clean exit (user Ctrl+C, both children shut down gracefully)
//   1+ first non-zero child exit code (after kill-others pass)
//
// Why Node and not bash? On Windows Git Bash, line-buffered stdout with
// per-line prefix is awkward to do in shell (socat / awk / tail -F all have
// quirks). Node gives us child_process.spawn + setEncoding + raw keypress
// listening — all platform-uniform — in ~150 lines.

'use strict';

const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

// ─── ANSI palette (auto-disabled when not TTY or --no-color) ────────────────
const useColor = process.stdout.isTTY && !process.argv.includes('--no-color');
const C = useColor ? {
  r:  '\x1b[0m',  // reset
  d:  '\x1b[2m',  // dim
  c:  '\x1b[36m', // cyan (backend)
  m:  '\x1b[35m', // magenta (frontend)
  g:  '\x1b[90m', // gray (exit info)
  yl: '\x1b[33m', // yellow (warnings)
} : Object.fromEntries(['r','d','c','m','g','yl'].map(k => [k, '']));

// ─── CLI parsing ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`dev run — foreground dev loop multiplexer

Usage: bash dev/dev run [backend|frontend] [flags]

Flags:
  --no-color            Disable ANSI colors
  --kill-others=false   Don't kill siblings when one exits
  --help, -h            Show this help

The script is invoked by 'bash dev/dev run'. You usually don't call it
directly.`);
  process.exit(0);
}

const only = argv.find(a => ['backend','frontend','both'].includes(a));
const killOthers = !argv.includes('--kill-others=false');

// ─── Service specs ─────────────────────────────────────────────────────────
// Paths are absolute so the script works regardless of where it was invoked.
const ROOT = path.resolve(__dirname, '..', '..');  // dev/cli/ → repo root
const backendPort = process.env.BACKEND_PORT || '8000';
const frontendPort = process.env.FRONTEND_PORT || '3000';

const backend = {
  name: 'backend',
  color: C.c,
  tag: 'BACKEND ',
  cmd: path.join(ROOT, 'backend', 'scripts', 'dev.py'),
  args: ['--port', backendPort],
  cwd: path.join(ROOT, 'backend'),
};
const frontend = {
  name: 'frontend',
  color: C.m,
  tag: 'FRONTEND',
  cmd: 'npm',
  args: ['run', 'dev'],
  cwd: path.join(ROOT, 'frontend'),
};

const targets = only === 'backend'  ? [backend]
              : only === 'frontend' ? [frontend]
              :                       [backend, frontend];

// ─── Spawn + line-buffered prefix output ───────────────────────────────────
const children = [];

function tag(svc, line) {
  return `${svc.color}${svc.tag}${C.r}| ${line}\n`;
}

function pipeLines(svc, stream) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();  // last partial stays in buf
    for (const l of lines) process.stdout.write(tag(svc, l));
  });
  stream.on('end', () => {
    if (buf) process.stdout.write(tag(svc, buf));
  });
}

function start(svc) {
  // Inherit env (DATABASE_URL, ALLOWED_ORIGINS, BACKEND_PORT, etc.) and
  // add defaults matching compose convention. PYTHONUNBUFFERED=1 forces
  // uvicorn to flush per-line (so our prefix interleaving doesn't sit
  // on a 4KB buffer for 30s). FORCE_COLOR=1 keeps uvicorn / next ANSI.
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    FORCE_COLOR: '1',
  };
  if (!env.DATABASE_URL) {
    env.DATABASE_URL = 'postgresql://english_dev:devpw@localhost:5432/english_dev';
  }
  if (!env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS = `http://localhost,http://localhost:${frontendPort},http://localhost:54102,http://localhost:55407,http://localhost:55500`;
  }

  const child = spawn(svc.cmd, svc.args, {
    cwd: svc.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeLines(svc, child.stdout);
  pipeLines(svc, child.stderr);
  child.on('exit', (code, signal) => {
    const reason = signal ? `${C.yl}signal=${signal}${C.r}`
                          : `code=${code}`;
    process.stdout.write(
      `${svc.color}${svc.tag}${C.r}| ${C.g}${reason}${C.r}\n`
    );
    if (killOthers) {
      for (const other of children) {
        if (other !== child && !other.killed) other.kill('SIGTERM');
      }
    }
    // Grace period for siblings to drain, then exit with the original code.
    // If a second child also exits before the timer fires, we'll exit
    // twice — Node logs a warning but the exit code is honored.
    setTimeout(() => process.exit(code || 0), 1500);
  });
  children.push(child);
}

for (const svc of targets) start(svc);

// ─── Signal handling ───────────────────────────────────────────────────────
function shutdown(sig) {
  for (const c of children) {
    if (!c.killed) c.kill(sig);
  }
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Windows: when launched from a regular PowerShell or cmd (no MSYS),
// Ctrl+C doesn't reliably deliver SIGINT to Node. Listen for raw keypress
// as a belt-and-suspenders fallback so the user always has a way out.
if (process.platform === 'win32' && process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key && key.ctrl && key.name === 'c') {
      shutdown('SIGINT');
    }
  });
  process.stdin.resume();
}