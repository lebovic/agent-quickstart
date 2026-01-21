"use client"

import { useState } from "react"

type DiffLineType = "add" | "remove" | "normal"

type DiffLine = {
  type: DiffLineType
  content: string
  oldLineNum?: number
  newLineNum?: number
}

type DiffViewProps = {
  lines: DiffLine[]
  maxLines?: number
}

function DiffLineRenderer({ line }: { line: DiffLine }) {
  const rowBgColor = line.type === "add" ? "bg-success-900" : line.type === "remove" ? "bg-danger-900" : ""

  const gutterBgColor = line.type === "add" ? "bg-success-900/50" : line.type === "remove" ? "bg-danger-900/50" : "bg-bg-200/50"

  const textColor = line.type === "add" ? "text-success-000" : line.type === "remove" ? "text-danger-000" : "text-text-100"

  const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " "

  const lineNum = line.oldLineNum ?? line.newLineNum ?? ""

  return (
    <div className="flex font-mono text-[13px]">
      {/* Line number gutter with dimmed background */}
      <div className={`flex items-start ${gutterBgColor} border-r border-border-300/50`}>
        <span className="w-8 px-2 text-right text-text-400 select-none shrink-0">{lineNum}</span>
      </div>
      {/* Prefix and content with row background */}
      <div className={`flex flex-1 min-w-0 ${rowBgColor}`}>
        <span className={`${textColor} select-none w-5 pl-1 shrink-0`}>{prefix}</span>
        <span className={`${textColor} whitespace-pre-wrap break-all flex-1 pr-2`}>{line.content}</span>
      </div>
    </div>
  )
}

export function DiffView({ lines, maxLines = 10 }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false)

  const needsTruncation = lines.length > maxLines
  const displayLines = expanded || !needsTruncation ? lines : lines.slice(0, maxLines)
  const remainingLines = lines.length - maxLines

  return (
    <div className="rounded overflow-hidden border-[0.5px] border-border-300">
      {displayLines.map((line, i) => (
        <DiffLineRenderer key={i} line={line} />
      ))}
      {needsTruncation && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-1 text-[12px] text-text-400 hover:text-text-200 hover:bg-bg-100 transition-colors"
        >
          Show full diff ({remainingLines} more lines)
        </button>
      )}
    </div>
  )
}

// Helper to create diff lines for a Write tool (all additions)
export function createWriteDiffLines(content: string): DiffLine[] {
  const lines = content.split("\n")
  return lines.map((line, i) => ({
    type: "add" as const,
    content: line,
    newLineNum: i + 1,
  }))
}

// Helper to create diff lines for an Edit tool (old_string -> new_string)
export function createEditDiffLines(oldString: string, newString: string): DiffLine[] {
  const oldLines = oldString.split("\n")
  const newLines = newString.split("\n")
  const result: DiffLine[] = []

  // Simple diff: show all old lines as removed, all new lines as added
  // For a more sophisticated diff, you'd use a proper diff algorithm
  let oldLineNum = 1
  let newLineNum = 1

  for (const line of oldLines) {
    result.push({
      type: "remove",
      content: line,
      oldLineNum: oldLineNum++,
    })
  }

  for (const line of newLines) {
    result.push({
      type: "add",
      content: line,
      newLineNum: newLineNum++,
    })
  }

  return result
}
