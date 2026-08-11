import { useState } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VersionBanner } from "@/components/VersionBanner"
import { ContainerCard } from "@/components/ContainerCard"
import { HostStats } from "@/components/HostStats"
import { LogViewer } from "@/components/LogViewer"
import { api, type Container } from "@/lib/api"
import { usePolling } from "@/hooks/usePolling"
import { cn } from "@/lib/utils"

function ContainerSkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="py-5">
            <div className="h-4 w-1/3 rounded bg-muted/50 animate-pulse" />
            <div className="mt-3 h-3 w-2/3 rounded bg-muted/40 animate-pulse" />
            <div className="mt-5 h-2 w-full rounded bg-muted/30 animate-pulse" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function App() {
  // One shared snapshot — pulls version + containers + host in a single request.
  const snapshot = usePolling(api.snapshot, 5000, true)
  const logs = usePolling<{ service: string; lines: string[] } | null>(
    async () => api.logs("all", 50).catch(() => null),
    5000,
    true,
  )

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  // Track when snapshot succeeds to display the "last updated" indicator.
  if (snapshot.data && (!lastUpdated || snapshot.data.generated_at !== lastUpdated.toISOString())) {
    setLastUpdated(new Date(snapshot.data.generated_at))
  }

  return (
    <div className="min-h-full">
      <div className="container py-6 lg:py-8">
        {/* Top header strip */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">tal</span>
              <span>›</span>
              <span>monitor</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">type-any-language · cvm monitor</h1>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {lastUpdated && (
              <span title={lastUpdated.toLocaleString()}>
                updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => snapshot.refresh()}
              disabled={snapshot.loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", snapshot.loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        {/* Error banner (read-only, doesn't block the rest of the page) */}
        {snapshot.error && (
          <Card className="mb-6 border-destructive/40 bg-destructive/5">
            <CardContent className="flex items-center gap-3 py-4 text-sm">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <div>
                <div className="font-medium text-destructive">backend unreachable</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {snapshot.error.message}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => snapshot.refresh()}
              >
                retry
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-6">
          <VersionBanner version={snapshot.data?.version ?? null} />

          {/* Container cards: 3 across on md+, 1 col on mobile */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {snapshot.data ? (
              snapshot.data.containers.map((c) => (
                <ContainerCard key={c.name} container={c} />
              ))
            ) : (
              <ContainerSkeletonRow />
            )}
          </div>

          <HostStats host={snapshot.data?.host ?? null} />

          {/* Tabs: Overview (the snapshot) / Logs (expandable per-service) */}
          <Tabs defaultValue="logs" className="space-y-4">
            <TabsList>
              <TabsTrigger value="logs">logs</TabsTrigger>
              <TabsTrigger value="info">info</TabsTrigger>
            </TabsList>
            <TabsContent value="logs" className="space-y-3">
              {snapshot.data?.containers.length ? (
                <LogsTab
                  containers={snapshot.data.containers}
                  combinedLines={logs.data?.lines ?? null}
                  loading={logs.loading}
                />
              ) : (
                <Card>
                  <CardContent className="py-6 text-center text-sm text-muted-foreground">
                    waiting for backend…
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="info">
              <Card>
                <CardContent className="py-5 font-mono text-xs text-muted-foreground">
                  <div>endpoint: /api/v1/monitor/snapshot</div>
                  <div>poll: every 5s (in-flight requests skip)</div>
                  <div>data sources: docker inspect · docker ps · /proc/stat · /proc/meminfo · df</div>
                  <div className="mt-3 text-foreground">refresh via header button or wait for next poll</div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <footer className="mt-10 text-center text-xs text-muted-foreground">
          monitor · runs on 127.0.0.1:9090 · {snapshot.data ? "live" : "offline"}
        </footer>
      </div>
    </div>
  )
}

function LogsTab({
  containers,
  combinedLines,
  loading,
}: {
  containers: Container[]
  combinedLines: string[] | null
  loading: boolean
}) {
  // The backend returns a "all" combined view; we split it back per service
  // by matching the first token. If the backend doesn't support that, we
  // still get something useful (just everything under one tab).
  const byService: Record<string, string[]> = {}
  if (combinedLines) {
    for (const line of combinedLines) {
      // Backend format: "<service> | <log line>"; if not, bucket as raw
      const m = line.match(/^([a-z_]+)\s*\|\s?(.*)$/i)
      const key = m ? m[1] : "raw"
      const text = m ? m[2] : line
      ;(byService[key] ??= []).push(text)
    }
  }
  // If combined is empty/malformed, show a single "raw" tab with the
  // combined output so we still surface something.
  const services = containers.length
    ? containers.map((c) => c.service)
    : Object.keys(byService)

  if (!services.length) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          no containers
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {services.map((svc) => (
        <LogViewer
          key={svc}
          service={svc}
          lines={byService[svc] ?? null}
          loading={loading && !byService[svc]}
        />
      ))}
    </div>
  )
}
