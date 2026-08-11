# telemetry

Read-only CVM monitor: deployment version, container health, host
resources, logs. Single-page React dashboard (dark, shadcn-style)
backed by a Python stdlib HTTP server (no third-party deps).

## What you get

- **Version banner** — `IMAGE_TAG` + git SHA + drift indicator
  (green if running images' LABELs match `IMAGE_TAG`, red if drift)
- **3 container cards** — db / backend / frontend, each showing status,
  uptime, port, image
- **Host stats** — load avg, memory bar, disk bar (focused on
  `/var/lib/type-any-language`), docker daemon health
- **Logs viewer** — collapsible per-service, last 50 lines, color-coded
  errors/warnings, auto-refreshes every 5 s
- **5 s auto-refresh** across the whole page (skip if a request is in
  flight)
- **Drill-down** for the dev workflow: drift exposes the actual vs
  expected tags right in the banner

## Layout

```
telemetry/
├── web/                  # Vite + React + shadcn/ui frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/   # VersionBanner, ContainerCard, HostStats, LogViewer, ui/*
│   │   ├── hooks/        # usePolling
│   │   └── lib/          # api.ts (typed fetchers) + utils.ts
│   ├── package.json
│   └── dist/             # build artifacts (git-tracked)
├── server/               # Python stdlib HTTP server
│   └── server.py
├── systemd/              # systemd unit file
│   └── tal-telemetry.service
├── install.sh            # installer (CVM)
└── README.md
```

## Develop (on a workstation)

```bash
cd telemetry/web
npm install
npm run dev          # vite dev server on :5173, proxies /api/* to :9090
```

For a full end-to-end test, in another terminal run the Python server
(it reads docker inspect from the host you're on):

```bash
TAL_TELEMETRY_PORT=9090 python3 telemetry/server/server.py
```

…then open `http://localhost:5173`. (The dev container does not need
docker — the server uses the host's `/var/run/docker.sock`; on a
workstation, it just shows an empty container list.)

## Build for production

```bash
cd telemetry/web
npm run build       # outputs web/dist/
```

The build artifacts (`web/dist/`) are committed to git so the CVM
never needs Node.js — the Python server just `http.server`-s them.

## Deploy (on the CVM)

The CVM needs Python 3 + Docker (already present per the
`ops/cvm/bootstrap.sh` flow). It does NOT need Node.

```bash
# 1. Copy this directory to /opt/type-any-language/telemetry
#    (rsync, scp -r, or whatever release flow you use)
# 2. Run the installer
sudo bash /opt/type-any-language/telemetry/install.sh
```

The installer:

1. Verifies `python3` / `docker` / `systemctl` are present
2. Verifies `web/dist/` was built
3. Installs `tal-telemetry.service` into `/etc/systemd/system/`
4. `daemon-reload` + `enable` + `restart`
5. Waits up to 10 s for the service to respond to the first API call

After install:

- Dashboard: `http://127.0.0.1:9090`
- Service status: `sudo systemctl status tal-telemetry`
- Logs: `sudo journalctl -u tal-telemetry -f`
- Stop: `sudo systemctl stop tal-telemetry`

## Network surface

**Listens on `127.0.0.1:9090` only.** No external exposure by default.
For remote viewing, use an SSH tunnel:

```bash
ssh -L 9090:127.0.0.1:9090 <cvm>
# then open http://localhost:9090 in your browser
```

Exposing publicly would require (a) a reverse proxy in front with
auth, and (b) network ACLs. Both are out of scope for v1.

## API surface

All endpoints return JSON. The Python server is read-only — there are
no mutating endpoints.

```
GET /api/v1/telemetry/snapshot
GET /api/v1/telemetry/version
GET /api/v1/telemetry/containers
GET /api/v1/telemetry/host
GET /api/v1/telemetry/logs/<service>?tail=100
```

`<service>` is one of `db`, `backend`, `frontend`, or `all` (combined).
`tail` defaults to 100, max 1000.

## How drift detection works

`IMAGE_TAG` is the env var the CVM was deployed with (forwarded from
the git tag by `publish-prod.yml`). Each container image has a
`type-any-language.app.version` LABEL baked at build time via
`--build-arg APP_VERSION=$IMAGE_TAG`.

The banner compares the two. If any of `db` / `backend` / `frontend`
has a different LABEL value than `IMAGE_TAG`, drift is flagged red
and the actual vs expected values are surfaced inline.

This catches the common "someone manually `docker pull`ed an old image
without telling anyone" failure mode.

## Why not a real framework / Next.js / cAdvisor / Prometheus

See the project discussion that landed on this stack. tl;dr: a small
single-page read-only dashboard doesn't need SSR, API routes, or a
metrics store. Stdlib Python + shadcn/ui on Vite is the smallest
stack that still looks great.

## Updating after edits

```bash
# on dev host
cd telemetry/web
npm run build
git add telemetry/web/dist
git commit -m "telemetry: rebuild"

# on CVM
cd /opt/type-any-language
git pull
sudo bash telemetry/install.sh   # reinstalls the unit + restarts
```
