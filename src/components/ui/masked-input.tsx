"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "./input"

interface MaskedInputProps extends Omit<React.ComponentProps<"input">, "onChange" | "value" | "type"> {
  displayValue?: string
  value: string
  onValueChange: (value: string) => void
  editing: boolean
  onEditingChange: (editing: boolean) => void
}

function MaskedInput({ displayValue, value, onValueChange, editing, onEditingChange, placeholder, className, ...props }: MaskedInputProps) {
  const [visible, setVisible] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Reset visibility when exiting edit mode
  React.useEffect(() => {
    if (!editing) {
      setVisible(false)
    }
  }, [editing])

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [editing])

  if (!editing) {
    // Display mode: show masked value as normal text
    const hasDisplayValue = displayValue && displayValue.length > 0
    return (
      <div
        onClick={() => onEditingChange(true)}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background dark:bg-input/30 px-3 py-1 text-base md:text-sm shadow-xs transition-colors cursor-text",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          hasDisplayValue ? "text-text-100" : "text-muted-foreground",
          className
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onEditingChange(true)
          }
        }}
      >
        <span className="flex items-center">{hasDisplayValue ? displayValue : placeholder}</span>
      </div>
    )
  }

  // Edit mode: password input with visibility toggle
  const showToggle = value.length > 0

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type={visible ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className={cn(showToggle && "pr-10", className)}
        {...props}
      />
      {showToggle && (
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-300 hover:text-text-100 cursor-pointer"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
    </div>
  )
}

export { MaskedInput }
export type { MaskedInputProps }
