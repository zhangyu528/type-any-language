"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface TiltCardProps extends React.HTMLAttributes<HTMLDivElement> {
  maxTilt?: number
  scale?: number
  glare?: boolean
  children: React.ReactNode
}

export function TiltCard({
  className,
  maxTilt = 8,
  scale = 1.02,
  glare = true,
  children,
  ...props
}: TiltCardProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [transform, setTransform] = React.useState("")
  const [glarePos, setGlarePos] = React.useState({ x: 50, y: 50, opacity: 0 })

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const cx = rect.width / 2
    const cy = rect.height / 2
    const rx = ((y - cy) / cy) * -maxTilt
    const ry = ((x - cx) / cx) * maxTilt
    setTransform(
      `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${scale})`
    )
    if (glare) {
      setGlarePos({
        x: (x / rect.width) * 100,
        y: (y / rect.height) * 100,
        opacity: 0.15,
      })
    }
  }

  const handleMouseLeave = () => {
    setTransform("perspective(1000px) rotateX(0) rotateY(0) scale(1)")
    setGlarePos((p) => ({ ...p, opacity: 0 }))
  }

  return (
    <div
      ref={ref}
      className={cn(
        "relative transition-transform duration-fast ease-out will-change-transform",
        className
      )}
      style={{ transform }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {children}
      {glare && (
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,${glarePos.opacity}), transparent 50%)`,
            transition: "opacity 0.2s ease",
          }}
        />
      )}
    </div>
  )
}
