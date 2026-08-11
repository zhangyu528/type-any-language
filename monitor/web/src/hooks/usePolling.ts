import { useEffect, useRef, useState } from "react"

/**
 * usePolling — fetch `fn()` every `intervalMs`, pause when `enabled=false`.
 * Skips in-flight requests if the previous one hasn't resolved yet.
 */
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  enabled = true,
): { data: T | null; error: Error | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(false)
  const inFlight = useRef(false)

  const refresh = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const result = await fn()
      setData(result)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled) return
    refresh()
    const id = setInterval(refresh, intervalMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled])

  return { data, error, loading, refresh }
}
