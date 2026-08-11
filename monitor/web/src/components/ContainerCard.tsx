import { Database, Globe, Server } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatUptime } from "@/lib/utils"
import type { Container as ContainerData } from "@/lib/api"

const SERVICE_ICON: Record<string, typeof Database> = {
  db: Database,
  backend: Server,
  frontend: Globe,
}

const SERVICE_COLOR: Record<string, string> = {
  db: "text-amber-400",
  backend: "text-primary",
  frontend: "text-violet-400",
}

function StatusDot({ up }: { up: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        up ? "bg-success glow-success animate-pulse-soft" : "bg-destructive glow-destructive",
      )}
    />
  )
}

export function ContainerCardSkeleton() {
  return (
    <Card>
      <CardContent className="py-5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-3 w-32" />
        <Skeleton className="mt-4 h-2 w-full" />
      </CardContent>
    </Card>
  )
}

export function ContainerCard({ container }: { container: ContainerData }) {
  const Icon = SERVICE_ICON[container.service] ?? Server
  const iconColor = SERVICE_COLOR[container.service] ?? "text-muted-foreground"

  const isUp = container.status === "running"
  const variant = isUp ? "success" : "destructive"
  const statusLabel = container.status.charAt(0).toUpperCase() + container.status.slice(1)

  return (
    <Card className="overflow-hidden">
      <CardContent className="py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", iconColor)} />
            <div>
              <div className="font-mono text-sm font-semibold">{container.service}</div>
              <div className="text-xs text-muted-foreground">{container.name}</div>
            </div>
          </div>
          <StatusDot up={isUp} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="uppercase tracking-wider text-muted-foreground">uptime</div>
            <div className="font-mono text-sm">
              {isUp ? formatUptime(container.started_at) : "—"}
            </div>
          </div>
          <div>
            <div className="uppercase tracking-wider text-muted-foreground">port</div>
            <div className="font-mono text-sm">
              {container.port ? `:${container.port}` : "—"}
            </div>
          </div>
          <div className="col-span-2">
            <div className="uppercase tracking-wider text-muted-foreground">image</div>
            <div className="font-mono text-xs text-muted-foreground truncate" title={container.image}>
              {container.image.split("/").pop()}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Badge variant={variant}>{statusLabel}</Badge>
          {container.restarts > 0 && (
            <span className="text-xs text-muted-foreground">
              {container.restarts} restart{container.restarts === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
