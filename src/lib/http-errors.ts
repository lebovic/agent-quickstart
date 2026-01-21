import { NextResponse } from "next/server"
import { log } from "@/lib/logger"

type ErrorType = "authentication_error" | "permission_error" | "not_found_error" | "invalid_request_error" | "internal_error" | "conflict"

export function jsonError(type: ErrorType, message: string, status: number, details?: string) {
  return NextResponse.json(
    {
      type: "error",
      error: { type, message, ...(details && { details }) },
    },
    { status }
  )
}

export function unauthorized(message = "Authentication required") {
  return jsonError("authentication_error", message, 401)
}

export function forbidden(message: string) {
  return jsonError("permission_error", message, 403)
}

export function notFound(message: string) {
  return jsonError("not_found_error", message, 404)
}

export function badRequest(message: string) {
  return jsonError("invalid_request_error", message, 400)
}

export function conflict(message: string, details?: string) {
  return jsonError("conflict", message, 409, details)
}

export function internalError(err?: unknown, context?: Record<string, unknown>) {
  if (err) {
    log.error({ err, ...context }, "Internal server error")
  }
  return jsonError("internal_error", "Internal server error", 500)
}

export function serviceUnavailable(message: string) {
  return jsonError("internal_error", message, 503)
}
