import { describe, it, expect, beforeEach } from "vitest";
import {
  recordRequest,
  getRequestsPerMinute,
  getAvgResponseTime,
  getPercentile,
  getRecentLogs,
  clearMetrics,
} from "~/lib/metrics";
import type { RequestLogEntry } from "~/lib/types";

function makeEntry(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: overrides.id || "req-1",
    timestamp: overrides.timestamp || Date.now(),
    accountId: overrides.accountId || "acc-1",
    accountName: overrides.accountName || "test",
    method: overrides.method || "POST",
    path: overrides.path || "/v1/messages",
    statusCode: overrides.statusCode || 200,
    responseTime: overrides.responseTime || 100,
    attempts: overrides.attempts || 1,
    error: overrides.error,
  };
}

describe("metrics", () => {
  beforeEach(() => {
    clearMetrics();
  });

  describe("recordRequest()", () => {
    it("harus record request ke logs", () => {
      recordRequest(makeEntry({ id: "r1" }));
      const logs = getRecentLogs(10);
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe("r1");
    });

    it("harus newest first (unshift)", () => {
      recordRequest(makeEntry({ id: "r1" }));
      recordRequest(makeEntry({ id: "r2" }));
      const logs = getRecentLogs(10);
      expect(logs[0].id).toBe("r2");
      expect(logs[1].id).toBe("r1");
    });
  });

  describe("getRequestsPerMinute()", () => {
    it("harus return 0 saat kosong", () => {
      expect(getRequestsPerMinute()).toBe(0);
    });

    it("harus count requests dalam 60 detik terakhir", () => {
      recordRequest(makeEntry({ timestamp: Date.now() }));
      recordRequest(makeEntry({ timestamp: Date.now() }));
      recordRequest(makeEntry({ timestamp: Date.now() }));
      expect(getRequestsPerMinute()).toBe(3);
    });
  });

  describe("getAvgResponseTime()", () => {
    it("harus return 0 saat kosong", () => {
      expect(getAvgResponseTime()).toBe(0);
    });

    it("harus calculate average", () => {
      recordRequest(makeEntry({ responseTime: 100 }));
      recordRequest(makeEntry({ responseTime: 200 }));
      recordRequest(makeEntry({ responseTime: 300 }));
      expect(getAvgResponseTime()).toBe(200);
    });
  });

  describe("getPercentile()", () => {
    it("harus return 0 saat kosong", () => {
      expect(getPercentile(50)).toBe(0);
    });

    it("harus return correct p50", () => {
      for (let i = 1; i <= 100; i++) {
        recordRequest(makeEntry({ responseTime: i }));
      }
      expect(getPercentile(50)).toBe(50);
    });

    it("harus return correct p99", () => {
      for (let i = 1; i <= 100; i++) {
        recordRequest(makeEntry({ responseTime: i }));
      }
      expect(getPercentile(99)).toBe(99);
    });
  });

  describe("getRecentLogs()", () => {
    it("harus limit results", () => {
      for (let i = 0; i < 20; i++) {
        recordRequest(makeEntry({ id: `r${i}` }));
      }
      expect(getRecentLogs(5)).toHaveLength(5);
    });

    it("harus default ke 100", () => {
      for (let i = 0; i < 150; i++) {
        recordRequest(makeEntry({ id: `r${i}` }));
      }
      expect(getRecentLogs()).toHaveLength(100);
    });
  });
});
