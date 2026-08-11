// Type definitions matching the Python server's JSON responses.
// Backend is at /api/v1/telemetry/* — see server/server.py.

const BASE = "/api/v1/telemetry"

export type ContainerStatus = "running" | "exited" | "restarting" | "paused" | "dead" | "created" | "unknown"

export interface Container {
  name: string
  service: "db" | "backend" | "frontend" | string
  status: ContainerStatus
  health: "healthy" | "unhealthy" | "starting" | "none" | string
  uptime_seconds: number
  started_at: string | null
  image: string
  port: number | null
  restarts: number
}

export interface Host {
  hostname: string
  uptime: string
  load: [number, number, number]
  mem: { total: number; used: number; free: number; pct: number }
  disk: { mount: string; total: number; used: number; pct: number }[]
  docker: { ok: boolean; version: string; project: string | null }
}

export interface Version {
  image_tag: string
  git_sha: string | null
  drift: boolean
  expected_backend: string
  expected_frontend: string
  expected_db: string
  actual_backend: string | null
  actual_frontend: string | null
  actual_db: string | null
  deployed_at: string | null
}

export interface Snapshot {
  dev_mode: boolean
  version: Version
  containers: Container[]
  host: Host
  generated_at: string
}

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  snapshot: () => fetchJSON<Snapshot>("/snapshot"),
  version: () => fetchJSON<Version>("/version"),
  containers: () => fetchJSON<Container[]>("/containers"),
  host: () => fetchJSON<Host>("/host"),
  logs: (service: string, tail = 100) =>
    fetchJSON<{ service: string; lines: string[] }>(
      `/logs/${encodeURIComponent(service)}?tail=${tail}`,
    ),
}
