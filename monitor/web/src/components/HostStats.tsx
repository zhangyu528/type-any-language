import { Cpu, HardDrive, MemoryStick, Server } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatBytes, formatPercent } from "@/lib/utils"
import type { Host } from "@/lib/api"

function MetricBar({
  icon: Icon,
  label,
  used,
  total,
  pct,
  iconColor,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  used: number
  total: number
  pct: number
  iconColor: string
}) {
  const isHigh = pct >= 85
  const isMid = pct >= 65
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
          <span className="uppercase tracking-wider">{label}</span>
        </div>
        <span className="font-mono">
          <span className={cn("font-medium", isHigh ? "text-destructive" : isMid ? "text-warning" : "text-foreground")}>
            {pct}%
          </span>
          <span className="ml-2 text-muted-foreground">
            {formatBytes(used)} / {formatBytes(total)}
          </span>
        </span>
      </div>
      <Progress
        className="mt-2"
        value={pct}
        indicatorClassName={cn(
          isHigh ? "bg-destructive" : isMid ? "bg-warning" : "bg-primary",
        )}
      />
    </div>
  )
}

export function HostStatsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="space-y-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}

export function HostStats({ host }: { host: Host | null }) {
  if (!host) return <HostStatsSkeleton />

  const memPct = formatPercent(host.mem.used, host.mem.total)
  const dockerOk = host.docker.ok
  const primaryDisk = host.disk[0]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> host
          </CardTitle>
          <div className="font-mono text-xs text-muted-foreground">{host.hostname}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-6">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">load avg</div>
            <div className="mt-1 flex gap-3 font-mono text-sm">
              {host.load.map((v, i) => (
                <span
                  key={i}
                  className={cn(
                    "rounded px-2 py-0.5",
                    v >= 2 ? "bg-destructive/15 text-destructive" : "bg-muted/40 text-foreground",
                  )}
                >
                  {v.toFixed(2)}
                </span>
              ))}
              <span className="self-end text-xs text-muted-foreground">
                uptime: {host.uptime}
              </span>
            </div>
          </div>
        </div>

        <MetricBar
          icon={MemoryStick}
          label="memory"
          used={host.mem.used}
          total={host.mem.total}
          pct={memPct}
          iconColor="text-primary"
        />

        {primaryDisk && (
          <MetricBar
            icon={HardDrive}
            label={`disk (${primaryDisk.mount})`}
            used={primaryDisk.used}
            total={primaryDisk.total}
            pct={primaryDisk.pct}
            iconColor="text-amber-400"
          />
        )}

        <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              dockerOk ? "bg-success glow-success" : "bg-destructive glow-destructive",
            )}
          />
          <span className="text-muted-foreground">docker daemon</span>
          <span className="font-mono">{host.docker.version}</span>
          {host.docker.project && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono">project: {host.docker.project}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
