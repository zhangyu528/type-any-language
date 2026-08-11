import { Activity, GitCommit, Server, Tag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatUptime } from "@/lib/utils"
import type { Version } from "@/lib/api"

export function VersionBannerSkeleton() {
  return (
    <Card>
      <CardContent className="py-6">
        <div className="flex flex-wrap items-center gap-6">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-40" />
        </div>
      </CardContent>
    </Card>
  )
}

export function VersionBanner({ version }: { version: Version | null }) {
  if (!version) return <VersionBannerSkeleton />

  const driftClass = version.drift
    ? "glow-destructive"
    : "glow-success"
  const dotClass = version.drift ? "bg-destructive glow-destructive" : "bg-success glow-success"

  return (
    <Card>
      <CardContent className="py-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {/* Status dot */}
          <div className="flex items-center gap-3">
            <div className={cn("h-3 w-3 rounded-full", dotClass)} />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                status
              </div>
              <div className="text-sm font-semibold">
                {version.drift ? "drift detected" : "in sync"}
              </div>
            </div>
          </div>

          <div className="h-10 w-px bg-border" />

          {/* Hostname / type */}
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">host</div>
              <div className="font-mono text-sm font-medium">monitor.cvm</div>
            </div>
          </div>

          <div className="h-10 w-px bg-border" />

          {/* Image tag */}
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">image</div>
              <div className="font-mono text-sm font-medium">{version.image_tag || "—"}</div>
            </div>
          </div>

          <div className="h-10 w-px bg-border" />

          {/* Git SHA */}
          <div className="flex items-center gap-2">
            <GitCommit className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">commit</div>
              <div className="font-mono text-sm font-medium">
                {version.git_sha?.slice(0, 7) ?? "—"}
              </div>
            </div>
          </div>

          <div className="h-10 w-px bg-border" />

          {/* Deployed at */}
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">deployed</div>
              <div className="text-sm font-medium">
                {version.deployed_at
                  ? formatUptime(version.deployed_at) + " ago"
                  : "—"}
              </div>
            </div>
          </div>

          {/* Drift badge on the right */}
          {version.drift && (
            <Badge variant="destructive" className="ml-auto">
              drift
            </Badge>
          )}
        </div>

        {/* Sub-bar with detailed drift info if applicable */}
        {version.drift && (
          <div className={cn("mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs", driftClass)}>
            <div className="font-mono">
              expected: db={version.expected_db} backend={version.expected_backend} frontend={version.expected_frontend}
            </div>
            <div className="mt-1 font-mono text-muted-foreground">
              actual: db={version.actual_db ?? "—"} backend={version.actual_backend ?? "—"} frontend={version.actual_frontend ?? "—"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
