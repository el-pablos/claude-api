import { maskApiKey } from "./crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function sanitize(obj: unknown): unknown {
  if (typeof obj === "string") {
    if (obj.startsWith("sk-ant-")) return maskApiKey(obj);
    return obj;
  }
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lk = key.toLowerCase();
      if (
        lk.includes("apikey") ||
        lk.includes("api_key") ||
        lk.includes("secret") ||
        lk.includes("password") ||
        lk.includes("authorization") ||
        lk.includes("x-api-key")
      ) {
        result[key] = typeof value === "string" ? maskApiKey(value) : "***";
      } else {
        result[key] = sanitize(value);
      }
    }
    return result;
  }
  return obj;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  accountId?: string;
  durationMs?: number;
  statusCode?: number;
  error?: string;
  [key: string]: unknown;
}

const logListeners: Array<(entry: LogEntry) => void> = [];

export function onLog(listener: (entry: LogEntry) => void): () => void {
  logListeners.push(listener);
  return () => {
    const idx = logListeners.indexOf(listener);
    if (idx >= 0) logListeners.splice(idx, 1);
  };
}

function emit(entry: LogEntry): void {
  for (const listener of logListeners) {
    listener(entry);
  }
}

function formatEntry(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (extra) {
    const sanitized = sanitize(extra) as Record<string, unknown>;
    Object.assign(entry, sanitized);
  }
  return entry;
}

export const logger = {
  debug(message: string, extra?: Record<string, unknown>): void {
    if (!shouldLog("debug")) return;
    const entry = formatEntry("debug", message, extra);
    console.debug(JSON.stringify(entry));
    emit(entry);
  },

  info(message: string, extra?: Record<string, unknown>): void {
    if (!shouldLog("info")) return;
    const entry = formatEntry("info", message, extra);
    console.info(JSON.stringify(entry));
    emit(entry);
  },

  warn(message: string, extra?: Record<string, unknown>): void {
    if (!shouldLog("warn")) return;
    const entry = formatEntry("warn", message, extra);
    console.warn(JSON.stringify(entry));
    emit(entry);
  },

  error(message: string, extra?: Record<string, unknown>): void {
    if (!shouldLog("error")) return;
    const entry = formatEntry("error", message, extra);
    console.error(JSON.stringify(entry));
    emit(entry);
  },
};
