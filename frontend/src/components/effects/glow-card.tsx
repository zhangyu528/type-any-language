"use client"
import * as React from "react"
import { cn } from "@/lib/utils"

interface GlowCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glowColor?: string
  glowSize?: number
  children: React.ReactNode
}

export function GlowCard({
  className,
  glowColor = "var(--ds-action)",
  glowSize = 200,
  children,
  ...props
}: GlowCardProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [glare, setGlare] = React.useState({ x: 50, y: 50, visible: false })

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setGlare({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      visible: true,
    })
  }

  return (
    <div
      ref={ref}
      className={cn("group relative overflow-hidden", className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setGlare((p) => ({ ...p, visible: false }))}
      {...props}
    >
      {/* children first so they sit BELOW the glow overlay (z-20) */}
      <div className="relative z-10">{children}</div>
      {/* Glow overlay sits ABOVE children at z-20, pointer-events-none so
         children remain interactive. mix-blend-mode: multiply keeps dark
         text/icons readable (multiplied with dark = darker ≈ unchanged)
         while letting the glow color show through white card surface
         (white * slate = slate). */}
      <div
        className="pointer-events-none absolute inset-0 z-20 opacity-0 transition-opacity duration-base ease-out group-hover:opacity-100"
        style={{
          background: `radial-gradient(${glowSize}px circle at ${glare.x}% ${glare.y}%, ${glowColor}, transparent 70%)`,
          opacity: glare.visible ? 0.32 : 0,
          mixBlendMode: 'multiply',
        }}
      />
    </div>
  )
}
