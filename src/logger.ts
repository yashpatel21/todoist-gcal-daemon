import type { LogLevel } from './config.js'

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

let currentLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel]
}

function format(level: LogLevel, msg: string, ctx?: Record<string, unknown>): string {
  const ts = new Date().toISOString()
  const head = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`
  if (!ctx || Object.keys(ctx).length === 0) return head
  return `${head} ${safeStringify(ctx)}`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v instanceof Error) return serializeError(v)
      return v
    })
  } catch {
    return String(value)
  }
}

function serializeError(err: Error): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  }
  const anyErr = err as unknown as {
    code?: number | string
    status?: number | string
    errors?: unknown
    response?: { status?: number; data?: unknown }
    calendarId?: string
    eventId?: string
    requestPayload?: unknown
  }
  if (anyErr.code !== undefined) base.code = anyErr.code
  if (anyErr.status !== undefined) base.status = anyErr.status
  if (anyErr.errors !== undefined) base.errors = anyErr.errors
  if (anyErr.response?.data !== undefined) {
    base.responseStatus = anyErr.response.status
    base.responseData = anyErr.response.data
  }
  if (anyErr.calendarId !== undefined) base.calendarId = anyErr.calendarId
  if (anyErr.eventId !== undefined) base.eventId = anyErr.eventId
  if (anyErr.requestPayload !== undefined) base.requestPayload = anyErr.requestPayload
  return base
}

export const log = {
  debug(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog('debug')) console.log(format('debug', msg, ctx))
  },
  info(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog('info')) console.log(format('info', msg, ctx))
  },
  warn(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog('warn')) console.warn(format('warn', msg, ctx))
  },
  error(msg: string, ctx?: Record<string, unknown>): void {
    if (shouldLog('error')) console.error(format('error', msg, ctx))
  },
}
