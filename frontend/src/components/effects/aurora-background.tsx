"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * AuroraBackground — flowing color curtains rendered on Canvas.
 *
 * Inspired by React Bits Aurora: 3 color bands that flow, pulse, drift,
 * and breathe independently, blended together via CSS blur + composite ops.
 *
 * Includes a CSS mesh-gradient base layer beneath the canvas.
 *
 * Usage:
 *   <AuroraBackground />   // fixed full-viewport background
 *   <AuroraBackground className="relative h-[400px]" />  // scoped
 */

export interface Curtain {
  color: [number, number, number]
  baseY: number
  amp: number
  freq: number
  speed: number
  opacity: number
  width: number
  phase: number
  // Dynamic modulation parameters
  pulseSpeed: number
  pulseDepth: number
  driftSpeed: number
  driftRange: number
  sweepSpeed: number
  sweepRange: number
  breatheSpeed: number
  breatheRange: number
  ampSpeed: number
  ampRange: number
}

const DEFAULT_CURTAINS: Curtain[] = [
  {
    // Slate 浅蓝:亮一档,模拟高光带
    color: [126, 157, 191],
    baseY: 0.3,
    amp: 40,
    freq: 0.0012,
    speed: 0.12,
    opacity: 0.55,
    width: 320,
    phase: 0,
    pulseSpeed: 0.35,
    pulseDepth: 0.35,
    driftSpeed: 0.08,
    driftRange: 0.08,
    sweepSpeed: 0.06,
    sweepRange: 30,
    breatheSpeed: 0.1,
    breatheRange: 60,
    ampSpeed: 0.15,
    ampRange: 0.4,
  },
  {
    // Slate 主蓝:中等饱和
    color: [55, 138, 221],
    baseY: 0.5,
    amp: 55,
    freq: 0.001,
    speed: 0.1,
    opacity: 0.5,
    width: 380,
    phase: Math.PI * 0.7,
    pulseSpeed: 0.28,
    pulseDepth: 0.3,
    driftSpeed: 0.06,
    driftRange: 0.06,
    sweepSpeed: 0.05,
    sweepRange: 40,
    breatheSpeed: 0.08,
    breatheRange: 70,
    ampSpeed: 0.12,
    ampRange: 0.35,
  },
  {
    // Amber 琥珀:点缀色,出现频次低
    color: [250, 199, 117],
    baseY: 0.42,
    amp: 35,
    freq: 0.0014,
    speed: 0.15,
    opacity: 0.32,
    width: 300,
    phase: Math.PI * 1.3,
    pulseSpeed: 0.42,
    pulseDepth: 0.4,
    driftSpeed: 0.1,
    driftRange: 0.07,
    sweepSpeed: 0.07,
    sweepRange: 25,
    breatheSpeed: 0.12,
    breatheRange: 50,
    ampSpeed: 0.18,
    ampRange: 0.5,
  },
]

interface AuroraBackgroundProps {
  className?: string
  /** Override the default 3 color curtains */
  curtains?: Curtain[]
  /** Blur amount in px (default 50). Set 0 to disable. */
  blur?: number
  /** Render scale (0-1) for performance. Default 0.6 — blur hides the difference */
  resolution?: number
  /** Show the mesh-gradient base layer */
  showMesh?: boolean
}

export function AuroraBackground({
  className,
  curtains = DEFAULT_CURTAINS,
  blur = 50,
  resolution = 0.6,
  showMesh = true,
}: AuroraBackgroundProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Respect reduced-motion preference
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    const cv = canvas
    const cx = ctx
    let raf = 0
    let time = 0

    function resize() {
      const w = cv.offsetWidth
      const h = cv.offsetHeight
      cv.width = w * resolution
      cv.height = h * resolution
    }

    function getIsDark() {
      return document.documentElement.getAttribute("data-theme") === "dark"
    }

    function drawCurtain(c: Curtain) {
      const isDark = getIsDark()
      const opMul = isDark ? 1 : 1.6
      const [r, g, b] = c.color

      // 1. Brightness pulse
      const pulse =
        1 + Math.sin(time * c.pulseSpeed + c.phase) * c.pulseDepth
      const opacity = Math.min(1, Math.max(0.05, c.opacity * opMul * pulse))

      // 2. Vertical drift
      const driftY =
        Math.sin(time * c.driftSpeed + c.phase * 0.5) * c.driftRange
      const effectiveBaseY = c.baseY + driftY

      // 3. Horizontal sweep
      const sweepX =
        Math.sin(time * c.sweepSpeed + c.phase * 1.3) * c.sweepRange

      // 4. Width breathing
      const breathe =
        1 + Math.sin(time * c.breatheSpeed + c.phase * 0.8) * 0.2
      const effectiveWidth = c.width * breathe

      // 5. Amplitude flare
      const ampFlare =
        1 + Math.sin(time * c.ampSpeed + c.phase * 1.5) * c.ampRange
      const effectiveAmp = c.amp * ampFlare

      const points: Array<{ x: number; y: number }> = []
      const step = 16

      for (let x = -80; x <= cv.width + 80; x += step) {
        const px = x + sweepX
        const y =
          cv.height * effectiveBaseY +
          Math.sin(px * c.freq + time * c.speed + c.phase) * effectiveAmp +
          Math.sin(px * c.freq * 0.5 + time * c.speed * 0.6) *
            effectiveAmp *
            0.4
        points.push({ x: px, y })
      }

      if (points.length === 0) return

      // Filled curtain shape
      cx.beginPath()
      cx.moveTo(points[0].x, points[0].y - effectiveWidth)
      for (let i = 0; i < points.length; i++) {
        cx.lineTo(points[i].x, points[i].y - effectiveWidth * 0.3)
      }
      for (let i = points.length - 1; i >= 0; i--) {
        cx.lineTo(points[i].x, points[i].y + effectiveWidth * 0.3)
      }
      cx.closePath()

      const cy = cv.height * effectiveBaseY
      const grad = cx.createLinearGradient(
        0,
        cy - effectiveWidth,
        0,
        cy + effectiveWidth
      )
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
      grad.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${opacity * 0.3})`)
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${opacity})`)
      grad.addColorStop(0.7, `rgba(${r}, ${g}, ${b}, ${opacity * 0.3})`)
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
      cx.fillStyle = grad
      cx.fill()
    }

    function animate() {
      cx.clearRect(0, 0, cv.width, cv.height)

      if (!prefersReducedMotion) {
        time += 0.016
      }

      const isDark = getIsDark()
      cx.globalCompositeOperation = isDark ? "screen" : "source-over"
      curtains.forEach(drawCurtain)
      cx.globalCompositeOperation = "source-over"

      raf = requestAnimationFrame(animate)
    }

    resize()
    animate()
    window.addEventListener("resize", resize)

    // Pause animation when tab is not visible to save resources
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else if (!prefersReducedMotion) {
        animate()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [curtains, resolution])

  const blurStyle = blur > 0 ? { filter: `blur(${blur}px)` } : undefined

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className
      )}
      aria-hidden="true"
    >
      {/* Mesh gradient base layer */}
      {showMesh && (
        <div className="aurora-mesh absolute inset-0" />
      )}
      {/* Aurora canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={blurStyle}
      />
    </div>
  )
}
