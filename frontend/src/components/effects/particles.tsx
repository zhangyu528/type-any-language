"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ParticlesProps {
  className?: string
  count?: number
  minSize?: number
  maxSize?: number
  speed?: number
  connectDistance?: number
  color?: string
}

export function Particles({
  className,
  count = 50,
  minSize = 1,
  maxSize = 3,
  speed = 0.3,
  connectDistance = 120,
  color,
}: ParticlesProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Capture non-null references for closures
    const cv = canvas
    const cx = ctx

    let raf = 0
    let particles: Array<{
      x: number
      y: number
      vx: number
      vy: number
      r: number
      o: number
    }> = []

    function getColor() {
      if (color) return color
      const isDark = document.documentElement.getAttribute("data-theme") === "dark"
      return isDark ? "93, 202, 165" : "13, 110, 86"
    }

    function resize() {
      cv.width = cv.offsetWidth
      cv.height = cv.offsetHeight
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * cv.width,
        y: Math.random() * cv.height,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        r: Math.random() * (maxSize - minSize) + minSize,
        o: Math.random() * 0.5 + 0.1,
      }))
    }

    function animate() {
      cx.clearRect(0, 0, cv.width, cv.height)
      const c = getColor()

      particles.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = cv.width
        if (p.x > cv.width) p.x = 0
        if (p.y < 0) p.y = cv.height
        if (p.y > cv.height) p.y = 0

        cx.beginPath()
        cx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        cx.fillStyle = `rgba(${c}, ${p.o})`
        cx.fill()
      })

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < connectDistance) {
            cx.beginPath()
            cx.moveTo(particles[i].x, particles[i].y)
            cx.lineTo(particles[j].x, particles[j].y)
            cx.strokeStyle = `rgba(${c}, ${0.15 * (1 - dist / connectDistance)})`
            cx.lineWidth = 0.6
            cx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(animate)
    }

    resize()
    animate()
    window.addEventListener("resize", resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [count, minSize, maxSize, speed, connectDistance, color])

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    />
  )
}
