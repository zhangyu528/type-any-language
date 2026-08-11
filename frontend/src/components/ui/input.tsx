import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-md border border-border bg-card/60 px-4 py-2 text-sm text-ink",
          "font-mono placeholder:text-ink-faint",
          "transition-colors duration-fast ease-out",
          "focus-visible:outline-none focus-visible:border-slate focus-visible:ring-2 focus-visible:ring-slate/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
