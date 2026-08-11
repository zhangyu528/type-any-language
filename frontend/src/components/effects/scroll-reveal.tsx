"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ScrollRevealProps extends React.HTMLAttributes<HTMLDivElement> {
  delay?: number
  y?: number
  once?: boolean
  children: React.ReactNode
}

export function ScrollReveal({
  className,
  delay = 0,
  y = 16,
  once = true,
  children,
  ...props
}: ScrollRevealProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => setVisible(true), delay)
            if (once) observer.unobserve(el)
          } else if (!once) {
            setVisible(false)
          }
        })
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [delay, once])

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-slow ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0",
        className
      )}
      style={
        !visible
          ? { transform: `translateY(${y}px)` }
          : undefined
      }
      {...props}
    >
      {children}
    </div>
  )
}
