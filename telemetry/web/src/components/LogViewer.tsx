import { useState } from "react"
import { ChevronDown, ChevronRight, ScrollText, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function LogViewerSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-32 w-full" />
      </CardContent>
    </Card>
  )
}

export interface LogViewerProps {
  service: string
  lines: string[] | null
  loading?: boolean
  onRefresh?: () => void
}

export function LogViewer({ service, lines, loading, onRefresh }: LogViewerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-accent/30"
      >
        <CardTitle className="flex items-center gap-2 text-sm">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono">{service}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {lines ? `${lines.length} line${lines.length === 1 ? "" : "s"}` : "—"}
          </span>
        </CardTitle>
        {onRefresh && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onRefresh()
            }}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="ml-1.5">refresh</span>
          </Button>
        )}
      </button>
      {open && (
        <CardContent className="border-t">
          {loading && !lines ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <pre className="text-mono max-h-80 overflow-auto rounded bg-background/60 p-3 text-xs leading-relaxed">
              {lines && lines.length > 0 ? (
                lines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap break-all",
                      line.toLowerCase().includes("error") && "text-destructive",
                      line.toLowerCase().includes("warn") && "text-warning",
                    )}
                  >
                    {line}
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">no log lines</span>
              )}
            </pre>
          )}
        </CardContent>
      )}
    </Card>
  )
}
