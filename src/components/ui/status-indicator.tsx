export type IndicatorStatus = "error" | "message" | "completed" | "running" | "default"

const statusStyles: Record<IndicatorStatus, string> = {
  error: "text-danger-000",
  message: "text-text-300",
  completed: "text-success-100",
  running: "text-text-500 animate-blink",
  default: "text-border-300",
}

export function StatusIndicator({ status }: { status: IndicatorStatus }) {
  return <div className={`select-none text-sm ${statusStyles[status]}`}>●</div>
}
