import { EventEmitter } from "node:events";
import type { HistoryEntry } from "./types";

const MAX_ENTRIES = 5000;

const history: HistoryEntry[] = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function recordHistory(entry: HistoryEntry): void {
  history.unshift(entry);
  if (history.length > MAX_ENTRIES) {
    history.length = MAX_ENTRIES;
  }
  emitter.emit("entry", entry);
}

export interface HistoryQueryOptions {
  limit?: number;
  offset?: number;
  model?: string;
  status?: string;
  accountId?: string;
}

export interface HistoryQueryResult {
  entries: HistoryEntry[];
  total: number;
  hasMore: boolean;
}

export function getHistory(
  options: HistoryQueryOptions = {},
): HistoryQueryResult {
  const { limit = 50, offset = 0, model, status, accountId } = options;

  let filtered = history;

  if (model) {
    filtered = filtered.filter((e) => e.model === model);
  }

  if (status) {
    if (status === "success") {
      filtered = filtered.filter(
        (e) => e.statusCode >= 200 && e.statusCode < 400,
      );
    } else if (status === "error") {
      filtered = filtered.filter((e) => e.statusCode >= 400);
    } else {
      const code = parseInt(status, 10);
      if (!isNaN(code)) {
        filtered = filtered.filter((e) => e.statusCode === code);
      }
    }
  }

  if (accountId) {
    filtered = filtered.filter((e) => e.accountId === accountId);
  }

  const total = filtered.length;
  const entries = filtered.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return { entries, total, hasMore };
}

export interface HistoryStats {
  totalRequests: number;
  byModel: Record<string, number>;
  byStatus: Record<string, number>;
  byAccount: Record<string, { name: string; count: number }>;
  avgResponseTime: number;
}

export function getHistoryStats(): HistoryStats {
  const byModel: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byAccount: Record<string, { name: string; count: number }> = {};
  let totalResponseTime = 0;

  for (const entry of history) {
    byModel[entry.model] = (byModel[entry.model] || 0) + 1;

    const statusGroup = `${Math.floor(entry.statusCode / 100)}xx`;
    byStatus[statusGroup] = (byStatus[statusGroup] || 0) + 1;

    if (byAccount[entry.accountId]) {
      byAccount[entry.accountId].count += 1;
    } else {
      byAccount[entry.accountId] = {
        name: entry.accountName,
        count: 1,
      };
    }

    totalResponseTime += entry.responseTime;
  }

  return {
    totalRequests: history.length,
    byModel,
    byStatus,
    byAccount,
    avgResponseTime:
      history.length > 0 ? Math.round(totalResponseTime / history.length) : 0,
  };
}

export function clearHistory(): void {
  history.length = 0;
}

export function onHistoryEntry(
  listener: (entry: HistoryEntry) => void,
): () => void {
  emitter.on("entry", listener);
  return () => {
    emitter.off("entry", listener);
  };
}
