"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AssistantEvent, ToolResultBlock, SessionEvent, ToolUseBlock as ToolUseBlockType } from "@/lib/types/anthropic_session"
import { isWriteToolInput, isEditToolInput, getToolResultText, isToolResult } from "@/lib/types/anthropic_session"
import { TodoWriteInputSchema, type TodoItem } from "@/lib/schemas/event"
import { CodeBlock } from "@/components/ui/code-block"
import { DiffView, createWriteDiffLines, createEditDiffLines } from "@/components/ui/diff-view"
import { StatusIndicator, type IndicatorStatus } from "@/components/ui/status-indicator"

type Props = {
  event: AssistantEvent
  toolResultsMap: Map<string, ToolResultBlock>
  subagentEventsMap: Map<string, SessionEvent[]>
}

function ThinkingBlock(_props: { thinking: string }) {
  return null
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1({ children }) {
          return <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
        },
        h2({ children }) {
          return <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
        },
        h3({ children }) {
          return <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
        },
        h4({ children }) {
          return <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
        },
        h5({ children }) {
          return <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
        },
        h6({ children }) {
          return <h3 className="text-base font-semibold mb-2 mt-2 first:mt-0">{children}</h3>
        },
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "")
          const isInline = !match && !className
          const codeString = String(children).replace(/\n$/, "")

          if (isInline) {
            return (
              <code className="text-[13px] font-mono bg-bg-100 px-1 py-0.5 rounded" {...props}>
                {children}
              </code>
            )
          }

          return <CodeBlock language={match?.[1]}>{codeString}</CodeBlock>
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>
        },
        ul({ children }) {
          return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
        },
        li({ children }) {
          return <li>{children}</li>
        },
        a({ href, children }) {
          return (
            <a href={href} className="text-accent-main-100 hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        },
        strong({ children }) {
          return <strong className="font-semibold">{children}</strong>
        },
        em({ children }) {
          return <em className="italic">{children}</em>
        },
        blockquote({ children }) {
          return <blockquote className="border-l-2 border-border-300 pl-3 my-2 text-text-400 italic">{children}</blockquote>
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border-collapse">{children}</table>
            </div>
          )
        },
        th({ children }) {
          return <th className="border border-border-300 px-3 py-1.5 bg-bg-200 text-left font-medium">{children}</th>
        },
        td({ children }) {
          return <td className="border border-border-300 px-3 py-1.5">{children}</td>
        },
        hr() {
          return <hr className="my-4 border-border-300" />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1 text-sm font-book">
      <div className="text-center">
        <StatusIndicator status="message" />
      </div>
      <div className="break-words min-w-0 flex-1">
        <MarkdownContent content={text} />
      </div>
    </div>
  )
}

// Derive indicator status from tool result
function getToolIndicatorStatus(result?: ToolResultBlock): IndicatorStatus {
  if (!result) return "running"
  return result.is_error ? "error" : "completed"
}

function InlineToolResult({ content, isError }: { content: ToolResultBlock["content"]; isError?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const text = getToolResultText(content)

  // Handle empty content
  if (!text || text.trim() === "") {
    return (
      <div className="flex items-start gap-2 text-sm pl-4">
        <span className="text-text-500 shrink-0 text-xs select-none">└</span>
        <div className="flex-1 min-w-0 font-mono text-[13px] text-text-400">(No content)</div>
      </div>
    )
  }

  const lines = text.split("\n")
  const totalLines = lines.length

  // Truncate at whichever comes first: 4 lines or 300 characters
  const first4Lines = lines.slice(0, 4).join("\n")
  const truncatedText = first4Lines.length > 300 ? first4Lines.slice(0, 300) : first4Lines
  const needsTruncation = totalLines > 4 || text.length > 300

  // Count remaining lines from where we truncated
  const shownLines = truncatedText.split("\n").length
  const remainingLines = totalLines - shownLines

  const displayText = expanded || !needsTruncation ? text : truncatedText

  return (
    <div
      className={`flex items-start gap-2 text-sm pl-4 ${needsTruncation && !expanded ? "cursor-pointer" : ""}`}
      onClick={() => needsTruncation && !expanded && setExpanded(true)}
    >
      <span className="text-text-500 shrink-0 text-xs select-none">└</span>
      <div className={`flex-1 min-w-0 font-mono text-[13px] ${isError ? "text-red-800" : "text-text-100"}`}>
        <div className="whitespace-pre-wrap break-all">{displayText}</div>
        {needsTruncation && !expanded && <div className="text-text-500">… {remainingLines > 0 && `(+${remainingLines} lines)`}</div>}
      </div>
    </div>
  )
}

function getSummaryFromInput(input: unknown): string {
  if (typeof input !== "object" || input === null) return ""
  const obj = input as Record<string, unknown>
  if (typeof obj.description === "string") return obj.description
  if (typeof obj.command === "string") return obj.command
  if (typeof obj.file_path === "string") return obj.file_path
  if (typeof obj.pattern === "string") return obj.pattern
  if (typeof obj.query === "string") return obj.query
  if (typeof obj.url === "string") return obj.url
  return ""
}

function ToolUseBlock({ name, input, result }: { name: string; input: unknown; result?: ToolResultBlock }) {
  const [expanded, setExpanded] = useState(false)
  const summary = getSummaryFromInput(input)
  const status = getToolIndicatorStatus(result)

  const renderResult = () => {
    // Write tool: show all content as additions
    if (name === "Write" && isWriteToolInput(input)) {
      const lines = createWriteDiffLines(input.content)
      return (
        <div className="pl-4 mt-1">
          <DiffView lines={lines} />
        </div>
      )
    }

    // Edit tool: show old_string as removals, new_string as additions
    if (name === "Edit" && isEditToolInput(input)) {
      const lines = createEditDiffLines(input.old_string, input.new_string)
      return (
        <div className="pl-4 mt-1">
          <DiffView lines={lines} />
        </div>
      )
    }

    // Read tool: show line count instead of content
    if (name === "Read" && result && !result.is_error) {
      const text = getToolResultText(result.content)
      const lineCount = text.split("\n").length
      return (
        <div className="flex items-start gap-2 text-sm pl-4">
          <span className="text-text-500 shrink-0 text-xs select-none">└</span>
          <span className="font-mono text-[13px] text-text-100">
            Read {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </div>
      )
    }

    // WebSearch tool: simple completion message
    if (name === "WebSearch" && result && !result.is_error) {
      return (
        <div className="flex items-start gap-2 text-sm pl-4">
          <span className="text-text-500 shrink-0 text-xs select-none">└</span>
          <span className="font-mono text-[13px] text-text-100">Web search complete</span>
        </div>
      )
    }

    // TodoWrite tool: render todo list
    if (name === "TodoWrite") {
      const parsed = TodoWriteInputSchema.safeParse(input)
      if (parsed.success) {
        return (
          <div className="flex items-start gap-2 text-sm pl-4">
            <span className="text-text-500 shrink-0 text-xs select-none">└</span>
            <div className="flex flex-col gap-0.5">
              {parsed.data.todos.map((todo: TodoItem, idx: number) => {
                const displayText = todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content
                const statusClass =
                  todo.status === "completed" ? "line-through text-text-500" : todo.status === "pending" ? "text-text-500" : ""
                return (
                  <div key={todo.id ?? idx} className={`font-mono text-[13px] ${statusClass}`}>
                    ☐&nbsp;{displayText}
                  </div>
                )
              })}
            </div>
          </div>
        )
      }
    }

    // Default: show tool result
    if (result) {
      return <InlineToolResult content={result.content} isError={result.is_error} />
    }

    return null
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex items-start gap-1 min-w-0 ${summary ? "cursor-pointer" : ""}`}
        onClick={summary ? () => setExpanded(!expanded) : undefined}
      >
        <div className="text-center">
          <StatusIndicator status={status} />
        </div>
        <span className="text-sm font-medium text-text-200 shrink-0">{name}</span>
        {summary && (
          <span className={`text-[13px] text-text-500 font-mono mt-[1px] ${expanded ? "whitespace-pre-wrap break-all" : "truncate"}`}>
            {summary}
          </span>
        )}
      </div>
      {renderResult()}
    </div>
  )
}

function TaskToolBlock({ input, subagentEvents }: { input: unknown; subagentEvents: SessionEvent[] }) {
  const [expanded, setExpanded] = useState(false)
  const summary = getSummaryFromInput(input)

  // Build tool results map from subagent user events
  const subagentToolResults = new Map<string, ToolResultBlock>()
  for (const event of subagentEvents) {
    if (event.type === "user" && isToolResult(event)) {
      for (const block of event.message.content) {
        subagentToolResults.set(block.tool_use_id, block)
      }
    }
  }

  // Collect tool_use blocks from subagent assistant events
  const nestedTools: ToolUseBlockType[] = []
  for (const event of subagentEvents) {
    if (event.type === "assistant" && Array.isArray(event.message.content)) {
      for (const block of event.message.content) {
        if (block.type === "tool_use") {
          nestedTools.push(block)
        }
      }
    }
  }

  const canExpand = nestedTools.length > 0

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex items-start gap-1 min-w-0 ${canExpand ? "cursor-pointer" : ""}`}
        onClick={canExpand ? () => setExpanded(!expanded) : undefined}
      >
        <div className="text-center">
          <StatusIndicator status="completed" />
        </div>
        <span className="text-sm font-medium text-text-200 shrink-0">Task</span>
        {summary && <span className="text-[13px] text-text-500 font-mono mt-[1px] truncate">{summary}</span>}
      </div>
      {!expanded && canExpand && (
        <div className="flex items-start gap-2 text-sm pl-4 cursor-pointer" onClick={() => setExpanded(true)}>
          <span className="text-text-500 shrink-0 text-xs select-none">└</span>
          <span className="font-mono text-[13px] text-text-100">
            Used {nestedTools.length} {nestedTools.length === 1 ? "tool" : "tools"}
          </span>
        </div>
      )}
      {expanded && nestedTools.length > 0 && (
        <div className="pl-4 border-l border-border-300 ml-[6px] mt-1 flex flex-col gap-1">
          {nestedTools.map((tool, i) => (
            <ToolUseBlock key={i} name={tool.name} input={tool.input} result={subagentToolResults.get(tool.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AssistantEventComponent({ event, toolResultsMap, subagentEventsMap }: Props) {
  const content = event.message.content
  if (!Array.isArray(content)) return null

  return (
    <div className="flex flex-col gap-1">
      {content.map((block, i) => {
        if (block.type === "thinking") {
          return <ThinkingBlock key={i} thinking={block.thinking} />
        }
        if (block.type === "text") {
          return <TextBlock key={i} text={block.text} />
        }
        if (block.type === "tool_use") {
          if (block.name === "Task") {
            const subagentEvents = subagentEventsMap.get(block.id) || []
            return <TaskToolBlock key={i} input={block.input} subagentEvents={subagentEvents} />
          }
          const result = toolResultsMap.get(block.id)
          return <ToolUseBlock key={i} name={block.name} input={block.input} result={result} />
        }
        return null
      })}
    </div>
  )
}
