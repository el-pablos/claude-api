import type { RequestLogEntry } from "./types";

const MAX_LOG_ENTRIES = 1000;
const WINDOW_MS = 60_000;

const requestLogs: RequestLogEntry[] = [];
const responseTimes: number[] = [];
let requestTimestamps: number[] = [];

export function recordRequest(entry: RequestLogEntry): void {
  requestLogs.unshift(entry);
  if (requestLogs.length > MAX_LOG_ENTRIES) {
    requestLogs.length = MAX_LOG_ENTRIES;
  }
  responseTimes.push(entry.responseTime);
  if (responseTimes.length > MAX_LOG_ENTRIES) {
    responseTimes.shift();
  }
  requestTimestamps.push(entry.timestamp);
}

export function getRequestsPerMinute(): number {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((t) => now - t < WINDOW_MS);
  return requestTimestamps.length;
}

export function getAvgResponseTime(): number {
  if (responseTimes.length === 0) return 0;
  const sum = responseTimes.reduce((a, b) => a + b, 0);
  return Math.round(sum / responseTimes.length);
}

export function getPercentile(p: number): number {
  if (responseTimes.length === 0) return 0;
  const sorted = [...responseTimes].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function getRecentLogs(limit: number = 100): RequestLogEntry[] {
  return requestLogs.slice(0, limit);
}

export function getAllLogs(): RequestLogEntry[] {
  return requestLogs;
}

export function clearMetrics(): void {
  requestLogs.length = 0;
  responseTimes.length = 0;
  requestTimestamps = [];
}
