#!/usr/bin/env python3
"""
telemetry server — read-only CVM monitor + static-file host for the React
dashboard. Listens on 127.0.0.1:9090 (localhost only — SSH tunnel for
remote access; do not expose publicly without auth in front).

Routes:
  GET  /                              -> serves web/dist/index.html (or fallback)
  GET  /<static>                      -> serves web/dist/<static>
  GET  /api/v1/telemetry/snapshot      -> full snapshot (version + containers + host)
  GET  /api/v1/telemetry/version       -> just the version/drift section
  GET  /api/v1/telemetry/containers   -> just the container list
  GET  /api/v1/telemetry/host         -> just the host resources
  GET  /api/v1/telemetry/logs/<svc>   -> last N log lines (default N=100)

No external deps. Stdlib only. Reads docker via the daemon socket;
tolerates docker being down (returns 503-shaped JSON).
"""

from __future__ import annotations

import json
import os
import shutil
import re
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field, asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

HOST = os.environ.get("TAL_TELEMETRY_HOST", "127.0.0.1")
PORT = int(os.environ.get("TAL_TELEMETRY_PORT", "9090"))

# web/dist/ relative to this file's parent
STATIC_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"

DOCKER_TIMEOUT_S = 5
LOG_DEFAULT_TAIL = 100
LOG_MAX_TAIL = 1000

# Container ports to surface in the UI (service -> port). The actual
# listening port is the host port from compose; for the CVM stack this
# is 5432 (db) / 8000 (backend) / 3000 (frontend).
SERVICE_PORTS = {
    "db": 5432,
    "backend": 8000,
    "frontend": 3000,
}

# Host ports probed in dev mode (when IMAGE_TAG is unset). In dev,
# backend runs as a host uvicorn (no docker) and frontend runs as
# host next dev -- telemetry needs to discover them via lsof/ss rather
# than docker ps. These port numbers mirror SERVICE_PORTS above.
DEV_PROBE_PORTS = {
    "backend": 8000,
    "frontend": 3000,
}

# Set of service names that are HOST-NATIVE in dev (i.e. NOT in docker).
# When in dev mode and a port in DEV_PROBE_PORTS is listening, we
# synthesize a Container record for it.
DEV_HOST_SERVICES = {"backend", "frontend"}

# ---------------------------------------------------------------------------
# Errors (always JSON for the API; pages get the standard 500)
# ---------------------------------------------------------------------------

class TelemetryError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Docker helpers (subprocess, with timeouts; tolerate docker daemon down)
# ---------------------------------------------------------------------------

def _run(cmd: list[str], timeout: float = DOCKER_TIMEOUT_S) -> tuple[int, str, str]:
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return out.returncode, out.stdout, out.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"timeout after {timeout}s"
    except FileNotFoundError as e:
        return 127, "", str(e)


def docker_ok() -> tuple[bool, str]:
    """Returns (ok, version). ok=False if docker isn't reachable."""
    rc, out, _ = _run(["docker", "version", "--format", "{{.Server.Version}}"])
    if rc != 0 or not out.strip():
        return False, ""
    return True, out.strip()


def compose_project() -> str | None:
    rc, out, _ = _run([
        "docker", "compose", "-p", "type-any-language",
        "ps", "--format", "{{.Service}}",
    ])
    if rc != 0 or not out.strip():
        return None
    return "type-any-language"


# ---------------------------------------------------------------------------
# Dev-mode + host-process helpers
# ---------------------------------------------------------------------------
def _is_dev_mode() -> bool:
    """Dev mode = no IMAGE_TAG env var. In dev, we don't deploy from a
    git tag, so drift check is N/A and backend/frontend run as host
    processes (uvicorn / next dev) rather than in docker. telemetry
    auto-detects this and adapts its checks."""
    return not bool(os.environ.get("IMAGE_TAG"))

def _git_short_sha() -> str | None:
    rc, out, _ = _run(["git", "rev-parse", "--short", "HEAD"])
    if rc == 0 and out.strip():
        return out.strip()
    return None

def _probe_port(port: int) -> tuple[bool, int | None, str | None]:
    """Return (is_listening, pid, command) for a given TCP port. Tries
    ss (Linux), lsof (macOS/BSD), and netstat (Windows + Linux) in
    that order. Tolerates all being absent (returns False,None,None).

    netstat is the broadest fallback: it ships with Windows out of the
    box, and is installed on basically every Linux distro. Its `-ano`
    output is `TCP  local_addr:port  remote  state  PID`. PID is the
    5th whitespace-delimited column."""
    # 1. ss (Linux) — extracts pid + users:(("cmd",pid=...)) in one shot
    rc, stdout, _ = _run(["ss", "-tlnp", f"sport = :{port}"])
    if rc == 0 and stdout:
        for line in stdout.splitlines()[1:]:
            m = re.search(r"pid=(d+)", line)
            if m:
                pid = int(m.group(1))
                cmd_m = re.search(r'users:(("([^"]+)"', line)
                cmd = cmd_m.group(1) if cmd_m else None
                return True, pid, cmd
    # 2. lsof (macOS / BSD)
    rc, stdout, _ = _run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"])
    if rc == 0 and stdout:
        for line in stdout.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return True, int(parts[1]), parts[0]
    # 3. netstat (Windows + Linux fallback)
    rc, stdout, _ = _run(["netstat", "-ano", "-p", "TCP"])
    if rc == 0 and stdout:
        for line in stdout.splitlines():
            parts = line.split()
            if len(parts) < 5 or parts[0] != "TCP":
                continue
            local_addr = parts[1]
            state = parts[3]
            if state != "LISTENING":
                continue
            # local_addr is host:port or [ipv6]:port
            if not local_addr.endswith(f":{port}"):
                continue
            try:
                pid = int(parts[4])
                return True, pid, None
            except ValueError:
                continue
    return False, None, None

def _pid_start_time(pid: int) -> str | None:
    """Return start time of the given PID via `ps lstart=`. None on failure."""
    rc, out, _ = _run(["ps", "-p", str(pid), "-o", "lstart="])
    if rc != 0 or not out.strip():
        return None
    return _parse_docker_time(out.strip())

def _pid_command(pid: int, max_len: int = 200) -> str | None:
    rc, out, _ = _run(["ps", "-p", str(pid), "-o", "args="])
    if rc != 0 or not out.strip():
        return None
    return out.strip()[:max_len]


# ---------------------------------------------------------------------------
# Container snapshot
# ---------------------------------------------------------------------------

@dataclass
class Container:
    name: str
    service: str
    status: str
    health: str
    started_at: str | None
    image: str
    port: int | None
    restarts: int


def _parse_docker_time(s: str) -> str | None:
    """docker prints '2026-08-10 12:34:56 +0000 UTC' — turn into ISO 8601."""
    s = s.strip()
    if not s:
        return None
    try:
        # Strip trailing " UTC" since fromisoformat doesn't accept it
        cleaned = s.replace(" UTC", "").replace(" +0000", "+00:00")
        # Strip subseconds if present
        return cleaned
    except Exception:
        return s


def _collect_docker_containers() -> list[Container]:
    """Parse `docker ps -a` into Container records. Empty list on
    docker failure (caller checks docker_ok() first)."""
    out: list[Container] = []
    fmt = "{{.Names}}|{{.Label \"com.docker.compose.service\"}}|{{.Status}}|{{.Image}}|{{.Ports}}|{{.State}}"
    rc, stdout, _ = _run(["docker", "ps", "-a", "--format", fmt])
    if rc != 0:
        return out

    out: list[Container] = []
    fmt = "{{.Names}}|{{.Label \"com.docker.compose.service\"}}|{{.Status}}|{{.Image}}|{{.Ports}}|{{.State}}"
    rc, stdout, _ = _run(["docker", "ps", "-a", "--format", fmt])
    if rc != 0:
        return []

    for line in stdout.strip().splitlines():
        if not line.strip():
            continue
        parts = line.split("|", 5)
        if len(parts) < 6:
            continue
        name, service, status, image, ports, state = parts
        # status: "Up 2 hours" or "Exited (0) 5 minutes ago"
        # Extract a short state + uptime-ish
        up = status.lower().startswith("up")
        # Extract host port (the first X:Y or Y:X listed, prefer X:Y)
        port: int | None = None
        for tok in ports.split(","):
            tok = tok.strip()
            if "->" in tok:
                left = tok.split("->", 1)[0].strip()
                if ":" in left:
                    try:
                        port = int(left.rsplit(":", 1)[1])
                        break
                    except ValueError:
                        pass
        # Restart count
        restarts = 0
        rc2, inspect, _ = _run(["docker", "inspect", "--format", "{{.RestartCount}}|{{.State.StartedAt}}", name])
        if rc2 == 0 and inspect.strip():
            iparts = inspect.strip().splitlines()[0].split("|", 1)
            if len(iparts) == 2:
                try:
                    restarts = int(iparts[0])
                except ValueError:
                    restarts = 0
        # Health (Health.Status when a HEALTHCHECK is defined; "none" otherwise)
        health = "none"
        rc3, h, _ = _run(["docker", "inspect", "--format", "{{.State.Health.Status}}", name])
        if rc3 == 0 and h.strip():
            health = h.strip()
        # Started at
        started_at = None
        if len(iparts) == 2 and iparts[1].strip():
            started_at = _parse_docker_time(iparts[1])

        # Status short label
        if up:
            short = "running"
        else:
            short = state.lower() or "exited"
        out.append(Container(
            name=name,
            service=service or "unknown",
            status=short,
            health=health,
            started_at=started_at,
            image=image,
            port=port or SERVICE_PORTS.get(service),
            restarts=restarts,
        ))
    return out


def _collect_host_dev_processes() -> list[Container]:
    """In dev mode, backend (uvicorn :8000) and frontend (next dev :3000)
    run as host processes, not in docker. Probe each port via ss/lsof
    and synthesize Container records so the dashboard shows them with
    the same shape as docker-managed services. Returns [] for ports
    that are not listening (process not running)."""
    out: list[Container] = []
    for svc, port in DEV_PROBE_PORTS.items():
        if svc not in DEV_HOST_SERVICES:
            continue
        up, pid, ss_cmd = _probe_port(port)
        if not up:
            continue
        ps_cmd = _pid_command(pid) if pid else None
        image = ps_cmd or ss_cmd or (f"host:pid={pid}" if pid else f"host:port={port}")
        out.append(Container(
            name=f"host-{svc}-{port}",
            service=svc,
            status="running",
            health="none",
            started_at=_pid_start_time(pid) if pid else None,
            image=image,
            port=port,
            restarts=0,
        ))
    return out


def collect_containers() -> list[Container]:
    """All services visible to the operator. In CVM mode, this is the
    3 docker containers (db + backend + frontend). In dev mode, the
    backend + frontend are host processes (uvicorn / next dev), so we
    synthesize Container records for them via lsof/ss and prepend them
    to the docker list (which still contains db)."""
    out: list[Container] = []
    if _is_dev_mode():
        out.extend(_collect_host_dev_processes())
    if docker_ok()[0]:
        out.extend(_collect_docker_containers())
    return out


# ---------------------------------------------------------------------------
# Version + drift
# ---------------------------------------------------------------------------

@dataclass
class Version:
    image_tag: str
    git_sha: str | None
    drift: bool
    expected_backend: str
    expected_frontend: str
    expected_db: str
    actual_backend: str | None
    actual_frontend: str | None
    actual_db: str | None
    deployed_at: str | None


def _image_label(image: str, label: str) -> str | None:
    rc, out, _ = _run(["docker", "inspect", "--format", f"{{{{ index .Config.Labels \"{label}\" }}}}", image])
    if rc != 0 or not out.strip():
        return None
    val = out.strip()
    if val == "<no value>":
        return None
    return val


def collect_version() -> Version:
    """In CVM mode: compare IMAGE_TAG env (expected) with each running
    container's type-any-language.app.version LABEL (actual). In dev mode
    (no IMAGE_TAG), skip drift check and return a stub -- the dev
    workstation has no release tag to compare against."""
    if _is_dev_mode():
        return Version(
            image_tag="(dev)",
            git_sha=_git_short_sha(),
            drift=False,
            expected_backend="(dev -- no IMAGE_TAG)",
            expected_frontend="(dev -- no IMAGE_TAG)",
            expected_db="(dev -- no IMAGE_TAG)",
            actual_backend=None,
            actual_frontend=None,
            actual_db=None,
            deployed_at=None,
        )

    image_tag = os.environ.get("IMAGE_TAG", "")
    git_sha = os.environ.get("GIT_SHA")

    expected = {svc: image_tag for svc in ("db", "backend", "frontend")}
    actual: dict[str, str | None] = {}
    for svc in ("db", "backend", "frontend"):
        actual[svc] = None

    if docker_ok()[0]:
        for svc in ("db", "backend", "frontend"):
            # IMAGE_TAG is shared across all 3. To find each image's actual
            # LABEL we need the resolved full image ref per service.
            full_ref = f"ghcr.io/zhangyu528/type-any-language/english_{svc}:{image_tag}"
            actual[svc] = _image_label(full_ref, "type-any-language.app.version")

    drift = any(actual[svc] and actual[svc] != image_tag for svc in ("db", "backend", "frontend")) if image_tag else False

    # "deployed at" — newest StartedAt across the 3 containers
    deployed_at = None
    for c in collect_containers():
        if c.started_at:
            if deployed_at is None or c.started_at > deployed_at:
                deployed_at = c.started_at

    return Version(
        image_tag=image_tag,
        git_sha=git_sha,
        drift=drift,
        expected_backend=expected["backend"],
        expected_frontend=expected["frontend"],
        expected_db=expected["db"],
        actual_backend=actual["backend"],
        actual_frontend=actual["frontend"],
        actual_db=actual["db"],
        deployed_at=deployed_at,
    )


# ---------------------------------------------------------------------------
# Host resources
# ---------------------------------------------------------------------------

@dataclass
class Host:
    hostname: str
    uptime: str
    load: tuple[float, float, float]
    mem: dict
    disk: list[dict]
    docker: dict


def _read_proc_loadavg() -> tuple[float, float, float]:
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
        return float(parts[0]), float(parts[1]), float(parts[2])
    except Exception:
        return 0.0, 0.0, 0.0


def _read_proc_uptime() -> str:
    try:
        with open("/proc/uptime") as f:
            seconds = float(f.read().split()[0])
        days, rem = divmod(int(seconds), 86400)
        hours, rem = divmod(rem, 3600)
        minutes, _ = divmod(rem, 60)
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        if hours > 0:
            return f"{hours}h {minutes}m"
        return f"{minutes}m"
    except Exception:
        return "—"


def _read_proc_meminfo() -> dict:
    info: dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if ":" not in line:
                    continue
                k, _, v = line.partition(":")
                info[k.strip()] = int(v.strip().split()[0])  # kB
    except Exception:
        return {"total": 0, "used": 0, "free": 0, "pct": 0}
    total = info.get("MemTotal", 0) * 1024
    avail = info.get("MemAvailable", info.get("MemFree", 0)) * 1024
    used = max(0, total - avail)
    pct = round(used / total * 100) if total else 0
    return {"total": total, "used": used, "free": avail, "pct": pct}


def _read_df(paths: list[str]) -> list[dict]:
    out: list[dict] = []
    try:
        for p in paths:
            usage = shutil.disk_usage(p)
            total = usage.total
            used = usage.used
            pct = round(used / total * 100) if total else 0
            out.append({"mount": p, "total": total, "used": used, "pct": pct})
    except Exception:
        pass
    return out


def collect_host() -> Host:
    ok, version = docker_ok()
    project = compose_project()
    return Host(
        hostname=socket.gethostname(),
        uptime=_read_proc_uptime(),
        load=_read_proc_loadavg(),
        mem=_read_proc_meminfo(),
        disk=_read_df(["/var/lib/type-any-language", "/"]),
        docker={
            "ok": ok,
            "version": version,
            "project": project,
        },
    )


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

def collect_logs(service: str, tail: int) -> list[str]:
    """Return last N log lines for the given service. Service is one of
    'db', 'backend', 'frontend', or 'all' (combined)."""
    tail = max(1, min(int(tail or LOG_DEFAULT_TAIL), LOG_MAX_TAIL))
    if not docker_ok()[0]:
        return []

    # Resolve to a list of container names
    if service == "all":
        services = ("db", "backend", "frontend")
    else:
        services = (service,)

    out: list[str] = []
    for svc in services:
        rc, stdout, _ = _run([
            "docker", "compose", "-p", "type-any-language",
            "logs", "--no-color", "--no-log-prefix", "--tail", str(tail), svc,
        ])
        if rc != 0 or not stdout.strip():
            continue
        for line in stdout.splitlines():
            out.append(f"{svc} | {line}")
    return out


# ---------------------------------------------------------------------------
# Snapshot composition
# ---------------------------------------------------------------------------

def build_snapshot() -> dict[str, Any]:
    return {
        "generated_at": _now_iso(),
        "dev_mode": _is_dev_mode(),
        "version": asdict(collect_version()),
        "containers": [asdict(c) for c in collect_containers()],
        "host": asdict(collect_host()),
    }


def _now_iso() -> str:
    # Match JS Date.toISOString format: 2026-08-10T12:34:56.789Z
    # Python's datetime doesn't do ms directly; we approximate with microsecond truncation.
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        datetime.now(timezone.utc).strftime("%f")[:3] + "Z"


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "telemetry/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Quieter access log; keep it short.
        sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}\n")

    # --- routing ----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        try:
            url = urlparse(self.path)
            path = url.path
            # API
            if path.startswith("/api/v1/telemetry/"):
                self._handle_api(path[len("/api/v1/telemetry/"):], parse_qs(url.query))
                return
            # Everything else: static file, or fall back to index.html (SPA)
            self._handle_static(path)
        except TelemetryError as e:
            self._send_json({"error": str(e)}, status=e.status)
        except Exception as e:  # last-ditch safety net
            sys.stderr.write(f"[ERROR] {type(e).__name__}: {e}\n")
            self._send_json({"error": f"{type(e).__name__}: {e}"}, status=500)

    # --- API handlers ----------------------------------------------------

    def _handle_api(self, sub: str, qs: dict[str, list[str]]) -> None:
        if sub == "snapshot":
            self._send_json(build_snapshot())
        elif sub == "version":
            self._send_json(asdict(collect_version()))
        elif sub == "containers":
            self._send_json([asdict(c) for c in collect_containers()])
        elif sub == "host":
            self._send_json(asdict(collect_host()))
        elif sub.startswith("logs/"):
            service = sub[len("logs/"):]
            tail = int(qs.get("tail", [LOG_DEFAULT_TAIL])[0])
            self._send_json({
                "service": service,
                "lines": collect_logs(service, tail),
            })
        else:
            raise TelemetryError(f"unknown endpoint: /{sub}", status=404)

    # --- Static file serving ---------------------------------------------

    def _handle_static(self, path: str) -> None:
        if not STATIC_DIR.exists():
            # Build artifacts missing — return a clear message.
            self._send_text(
                "<h1>web/dist/ not built</h1>"
                "<p>Run <code>cd web && npm install && npm run build</code> on the dev host, "
                "then commit <code>web/dist/</code> and re-deploy.</p>",
                status=503,
            )
            return

        # Sanitize path
        rel = path.lstrip("/")
        if ".." in rel.split("/"):
            raise TelemetryError("bad path", status=400)
        target = (STATIC_DIR / rel).resolve()

        # If it's a real file inside STATIC_DIR, serve it
        try:
            target.relative_to(STATIC_DIR)
        except ValueError:
            raise TelemetryError("bad path", status=400)

        if target.is_file():
            self._send_file(target)
            return

        # Otherwise: SPA fallback — serve index.html for any non-asset path
        if not rel.startswith(("assets/", "favicon")):
            idx = STATIC_DIR / "index.html"
            if idx.is_file():
                self._send_file(idx)
                return
        raise TelemetryError(f"not found: {rel}", status=404)

    # --- senders --------------------------------------------------------

    def _send_json(self, obj: Any, status: int = 200) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        ext = path.suffix.lower()
        ctype = MIME.get(ext, "application/octet-stream")
        try:
            data = path.read_bytes()
        except OSError as e:
            raise TelemetryError(f"read error: {e}", status=500)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_text(self, html: str, status: int = 200) -> None:
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write(
        f"telemetry listening on http://{HOST}:{PORT} (static: {STATIC_DIR})\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("shutting down\n")
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
