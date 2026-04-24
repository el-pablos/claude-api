import { describe, it, expect, beforeEach } from "vitest";
import {
  recordUsage,
  getUsageOverview,
  getAccountUsage,
  getUsageRecords,
  clearUsage,
} from "~/lib/usage-tracker";
import type { UsageRecord } from "~/lib/usage-tracker";

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    timestamp: overrides.timestamp || Date.now(),
    accountId: overrides.accountId || "acc-1",
    accountName: overrides.accountName || "test-account",
    model: overrides.model || "claude-sonnet-4-20250514",
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    cacheReadTokens: overrides.cacheReadTokens ?? 0,
    cacheWriteTokens: overrides.cacheWriteTokens ?? 0,
    cost: overrides.cost ?? 0.001,
  };
}

describe("usage-tracker", () => {
  beforeEach(() => {
    clearUsage();
  });

  describe("recordUsage()", () => {
    it("harus record usage entry", () => {
      recordUsage(makeRecord());
      const records = getUsageRecords(10);
      expect(records).toHaveLength(1);
      expect(records[0].accountId).toBe("acc-1");
    });

    it("harus newest first (unshift)", () => {
      recordUsage(makeRecord({ accountId: "first" }));
      recordUsage(makeRecord({ accountId: "second" }));
      const records = getUsageRecords(10);
      expect(records[0].accountId).toBe("second");
      expect(records[1].accountId).toBe("first");
    });

    it("harus limit max 10000 entries", () => {
      for (let i = 0; i < 10005; i++) {
        recordUsage(makeRecord({ accountId: `acc-${i}` }));
      }
      const records = getUsageRecords(20000);
      expect(records.length).toBeLessThanOrEqual(10000);
    });
  });

  describe("getUsageOverview()", () => {
    it("harus return empty overview saat kosong", () => {
      const overview = getUsageOverview();
      expect(overview.totalRequests).toBe(0);
      expect(overview.totalInputTokens).toBe(0);
      expect(overview.totalOutputTokens).toBe(0);
      expect(overview.totalTokens).toBe(0);
      expect(overview.totalCost).toBe(0);
      expect(overview.byModel).toHaveLength(0);
      expect(overview.byAccount).toHaveLength(0);
      expect(overview.hourly).toHaveLength(0);
    });

    it("harus aggregate total tokens", () => {
      recordUsage(makeRecord({ inputTokens: 100, outputTokens: 50 }));
      recordUsage(makeRecord({ inputTokens: 200, outputTokens: 100 }));
      const overview = getUsageOverview();
      expect(overview.totalInputTokens).toBe(300);
      expect(overview.totalOutputTokens).toBe(150);
      expect(overview.totalTokens).toBe(450);
    });

    it("harus aggregate by model", () => {
      recordUsage(
        makeRecord({ model: "claude-sonnet-4-20250514", inputTokens: 100 }),
      );
      recordUsage(
        makeRecord({ model: "claude-sonnet-4-20250514", inputTokens: 200 }),
      );
      recordUsage(
        makeRecord({ model: "claude-opus-4-20250514", inputTokens: 500 }),
      );
      const overview = getUsageOverview();
      expect(overview.byModel).toHaveLength(2);
      const sonnet = overview.byModel.find((m) => m.model.includes("sonnet"));
      expect(sonnet).toBeTruthy();
      expect(sonnet!.inputTokens).toBe(300);
    });

    it("harus aggregate by account", () => {
      recordUsage(
        makeRecord({
          accountId: "acc-1",
          accountName: "akbar",
          inputTokens: 100,
        }),
      );
      recordUsage(
        makeRecord({
          accountId: "acc-2",
          accountName: "abdul",
          inputTokens: 200,
        }),
      );
      recordUsage(
        makeRecord({
          accountId: "acc-1",
          accountName: "akbar",
          inputTokens: 300,
        }),
      );
      const overview = getUsageOverview();
      expect(overview.byAccount).toHaveLength(2);
      const akbar = overview.byAccount.find((a) => a.accountId === "acc-1");
      expect(akbar).toBeTruthy();
      expect(akbar!.totalInputTokens).toBe(400);
      expect(akbar!.totalRequests).toBe(2);
    });

    it("harus group hourly data", () => {
      const now = Date.now();
      recordUsage(makeRecord({ timestamp: now }));
      recordUsage(makeRecord({ timestamp: now }));
      const overview = getUsageOverview();
      expect(overview.hourly.length).toBeGreaterThanOrEqual(1);
      expect(overview.hourly[0].requests).toBe(2);
    });

    it("harus calculate model percentage", () => {
      recordUsage(
        makeRecord({
          model: "a",
          inputTokens: 100,
          outputTokens: 0,
          cost: 0.01,
        }),
      );
      recordUsage(
        makeRecord({
          model: "b",
          inputTokens: 300,
          outputTokens: 0,
          cost: 0.03,
        }),
      );
      const overview = getUsageOverview();
      const modelA = overview.byModel.find((m) => m.model === "a");
      const modelB = overview.byModel.find((m) => m.model === "b");
      expect(modelA!.percentage).toBe(25);
      expect(modelB!.percentage).toBe(75);
    });

    it("harus limit hourly ke max 24 entries", () => {
      for (let i = 0; i < 30; i++) {
        const ts = new Date(2025, 0, 1, i, 0, 0).getTime();
        recordUsage(makeRecord({ timestamp: ts }));
      }
      const overview = getUsageOverview();
      expect(overview.hourly.length).toBeLessThanOrEqual(24);
    });
  });

  describe("getAccountUsage()", () => {
    it("harus return null untuk account yang tidak ada", () => {
      expect(getAccountUsage("nonexistent")).toBeNull();
    });

    it("harus return usage untuk account tertentu", () => {
      recordUsage(
        makeRecord({
          accountId: "acc-1",
          accountName: "test",
          inputTokens: 100,
        }),
      );
      const usage = getAccountUsage("acc-1");
      expect(usage).toBeTruthy();
      expect(usage!.totalInputTokens).toBe(100);
    });
  });

  describe("getUsageRecords()", () => {
    it("harus limit results", () => {
      for (let i = 0; i < 20; i++) {
        recordUsage(makeRecord());
      }
      const records = getUsageRecords(5);
      expect(records).toHaveLength(5);
    });

    it("harus default ke 100", () => {
      for (let i = 0; i < 150; i++) {
        recordUsage(makeRecord());
      }
      expect(getUsageRecords()).toHaveLength(100);
    });
  });

  describe("clearUsage()", () => {
    it("harus clear semua records", () => {
      recordUsage(makeRecord());
      recordUsage(makeRecord());
      clearUsage();
      expect(getUsageRecords()).toHaveLength(0);
      expect(getUsageOverview().totalRequests).toBe(0);
    });
  });
});
