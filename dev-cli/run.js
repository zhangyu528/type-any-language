#!/usr/bin/env node
// dev-cli/run.js — foreground dev loop multiplexer.
//
// Spawns two children and merges their stdout/stderr into one prefixed
// stream. No orchestration — each child owns its own bootstrap.
//
// Usage:
//   dev run                       # both
//   dev run backend               # backend only
//   dev run frontend              # frontend only
//   dev run --no-color            # disable ANSI
//   dev run --help
//
// Any flag we don't recognise is passed through to BOTH spawned children.

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

// ─── ANSI palette (auto-disabled when not TTY or --no-color) ────────────────
const useColor = process.stdout.isTTY && !process.argv.includes('--no-color');
const C = useColor ? {
  r:  '\x1b[0m', d:  '\x1b[2m', c:  '\x1b[36m',
  m:  '\x1b[35m', g:  '\x1b[90m', yl: '\x1b[33m',
} : Object.fromEntries(['r','d','c','m','g','yl'].map(k => [k, '']));

// ─── CLI parsing ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`dev run — foreground dev loop multiplexer

Usage: dev run [backend|frontend] [flags]

Spawns two children and merges their output. No orchestration.

Flags:
  backend, frontend       Spawn only that service
  --no-color              Disable ANSI colors
  --kill-others=false     Don't kill siblings when one exits
  --help, -h              Show this help

Any other flag is forwarded to BOTH spawned children.`);
  process.exit(0);
}

const only = argv.find(a => ['backend','frontend','both'].includes(a));
const killOthers = !argv.includes('--kill-others=false');

// Strip the spawn selectors + multiplexer-only flags from argv before
// forwarding; everything else goes to both children.
const SELF_FLAGS = new Set([
  '--no-color', '--kill-others=false',
  'backend', 'frontend', 'both',
]);
const passthrough = argv.filter(a => !SELF_FLAGS.has(a));

// ─── Paths ─────────────────────────────────────────────────────────────────
// dev-cli/run.js lives one level below the project root.
const ROOT = path.resolve(__dirname, '..');
const backendPort = process.env.BACKEND_PORT || '8000';
const frontendPort = process.env.FRONTEND_PORT || '3000';

// Resolve a Python interpreter: prefer the backend venv (Win: Scripts\python.exe,
//  POSIX: bin/python), fall back to 'python3' on PATH. Node's child_process.spawn
// can't exec a .py file directly on Windows; we need the interpreter as the
// executable and the script as its first arg.
//
// Called lazily in start() so we see whatever venv exists at spawn time.
function findPython() {
  const candidates = [
    path.join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, 'backend', '.venv', 'bin', 'python'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return 'python3';
}

const backend = {
  name: 'backend',
  color: C.c, tag: 'BACKEND ',
  cmd: null,                      // lazy-resolved in start()
  args: [path.join(ROOT, 'backend', 'scripts', 'dev.py'), '--port', backendPort, ...passthrough],
  cwd: path.join(ROOT, 'backend'),
};
const frontend = {
  name: 'frontend',
  color: C.m, tag: 'FRONTEND',
  cmd: 'npm', args: ['run', 'dev', '--', ...passthrough],
  cwd: path.join(ROOT, 'frontend'),
};
const targets = only === 'backend'  ? [backend]
              : only === 'frontend' ? [frontend]
              :                       [backend, frontend];

const children = [];
function tag(svc, line) { return `${svc.color}${svc.tag}${C.r}| ${line}\n`; }
function pipeLines(svc, stream) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) process.stdout.write(tag(svc, l));
  });
  stream.on('end', () => { if (buf) process.stdout.write(tag(svc, buf)); });
}
function start(svc) {
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
  // Backend: lazy-resolve python. Frontend: cmd is the literal 'npm'.
  const cmd = svc.cmd || findPython();
  // shell: true for npm on Windows so Node resolves the npm.cmd shim.
  const useShell = svc.cmd === 'npm';
  const child = spawn(cmd, svc.args, {
    cwd: svc.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: useShell,
  });
  pipeLines(svc, child.stdout);
  pipeLines(svc, child.stderr);
  child.on('exit', (code, signal) => {
    const reason = signal ? `${C.yl}signal=${signal}${C.r}` : `code=${code}`;
    process.stdout.write(`${svc.color}${svc.tag}${C.r}| ${C.g}${reason}${C.r}\n`);
    if (killOthers) {
      for (const other of children) {
        if (other !== child && !other.killed) other.kill('SIGTERM');
      }
    }
    setTimeout(() => process.exit(code || 0), 1500);
  });
  children.push(child);
}

// ─── Main ──────────────────────────────────────────────────────────────────
for (const svc of targets) start(svc);

function shutdown(sig) {
  for (const c of children) if (!c.killed) c.kill(sig);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32' && process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (key && key.ctrl && key.name === 'c') shutdown('SIGINT');
  });
  process.stdin.resume();
}