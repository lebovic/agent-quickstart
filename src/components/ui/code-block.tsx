"use client"

import { useState } from "react"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneLight } from "react-syntax-highlighter/dist/cjs/styles/prism"
import { Check, Copy } from "lucide-react"
import { Button } from "./button"

type Props = {
  language?: string
  children: string
}

export function CodeBlock({ language, children }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group my-2">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7 bg-bg-300/80 hover:bg-bg-400" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-text-400" />}
        </Button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: "1em",
          borderRadius: "0.375rem",
          fontSize: "13px",
          lineHeight: "1.5",
          background: "var(--color-bg-100)",
          border: "0.5px solid var(--color-border-300)",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)",
            background: "transparent",
          },
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}
