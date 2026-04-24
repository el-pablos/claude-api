import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateCost,
  getPricing,
  getAllPricing,
  recordDailyCost,
  getDailyCostHistory,
  getTodayCost,
  clearDailyCosts,
} from "~/lib/cost-calculator";

describe("cost-calculator", () => {
  beforeEach(() => {
    clearDailyCosts();
  });

  describe("getPricing()", () => {
    it("harus return pricing untuk claude sonnet 4", () => {
      const p = getPricing("claude-sonnet-4-20250514");
      expect(p.inputPerMillion).toBe(3.0);
      expect(p.outputPerMillion).toBe(15.0);
    });

    it("harus return pricing untuk claude opus 4", () => {
      const p = getPricing("claude-opus-4-20250514");
      expect(p.inputPerMillion).toBe(15.0);
      expect(p.outputPerMillion).toBe(75.0);
    });

    it("harus return pricing untuk claude haiku 3.5", () => {
      const p = getPricing("claude-haiku-3-5-20241022");
      expect(p.inputPerMillion).toBe(0.8);
      expect(p.outputPerMillion).toBe(4.0);
    });

    it("harus fallback ke sonnet pricing untuk model unknown dengan keyword sonnet", () => {
      const p = getPricing("some-sonnet-model");
      expect(p.inputPerMillion).toBe(3.0);
    });

    it("harus fallback ke opus pricing untuk model unknown dengan keyword opus", () => {
      const p = getPricing("some-opus-model");
      expect(p.inputPerMillion).toBe(15.0);
    });

    it("harus fallback ke haiku pricing untuk model unknown dengan keyword haiku", () => {
      const p = getPricing("some-haiku-model");
      expect(p.inputPerMillion).toBe(0.8);
    });

    it("harus return default pricing untuk model totally unknown", () => {
      const p = getPricing("totally-unknown-model");
      expect(p.inputPerMillion).toBe(3.0);
      expect(p.outputPerMillion).toBe(15.0);
    });
  });

  describe("calculateCost()", () => {
    it("harus calculate cost untuk sonnet 4", () => {
      const c = calculateCost("claude-sonnet-4-20250514", 1000000, 500000);
      expect(c.inputCost).toBe(3.0);
      expect(c.outputCost).toBe(7.5);
      expect(c.totalCost).toBe(10.5);
    });

    it("harus calculate cost untuk opus 4", () => {
      const c = calculateCost("claude-opus-4-20250514", 1000000, 1000000);
      expect(c.inputCost).toBe(15.0);
      expect(c.outputCost).toBe(75.0);
      expect(c.totalCost).toBe(90.0);
    });

    it("harus calculate cost dengan cache tokens", () => {
      const c = calculateCost(
        "claude-sonnet-4-20250514",
        500000,
        200000,
        100000,
        50000,
      );
      expect(c.inputCost).toBe(1.5);
      expect(c.outputCost).toBe(3.0);
      expect(c.cacheReadCost).toBe(0.03);
      expect(c.cacheWriteCost).toBe(0.1875);
      expect(c.totalCost).toBeCloseTo(4.7175, 4);
    });

    it("harus return 0 untuk zero tokens", () => {
      const c = calculateCost("claude-sonnet-4-20250514", 0, 0, 0, 0);
      expect(c.totalCost).toBe(0);
    });

    it("harus calculate cost kecil dengan presisi", () => {
      const c = calculateCost("claude-sonnet-4-20250514", 100, 50);
      expect(c.inputCost).toBe(0.0003);
      expect(c.outputCost).toBe(0.00075);
      expect(c.totalCost).toBe(0.00105);
    });
  });

  describe("getAllPricing()", () => {
    it("harus return array of pricing", () => {
      const pricing = getAllPricing();
      expect(pricing.length).toBeGreaterThan(0);
      expect(pricing[0]).toHaveProperty("model");
      expect(pricing[0]).toHaveProperty("inputPerMillion");
      expect(pricing[0]).toHaveProperty("outputPerMillion");
    });

    it("harus include semua model utama", () => {
      const pricing = getAllPricing();
      const models = pricing.map((p) => p.model);
      expect(models).toContain("claude-sonnet-4-20250514");
      expect(models).toContain("claude-opus-4-20250514");
      expect(models).toContain("claude-haiku-3-5-20241022");
    });
  });

  describe("recordDailyCost()", () => {
    it("harus record daily cost", () => {
      recordDailyCost("2025-01-15", "claude-sonnet-4-20250514", 0.5);
      const history = getDailyCostHistory();
      expect(history).toHaveLength(1);
      expect(history[0].date).toBe("2025-01-15");
      expect(history[0].totalCost).toBe(0.5);
    });

    it("harus accumulate cost untuk tanggal yang sama", () => {
      recordDailyCost("2025-01-15", "claude-sonnet-4-20250514", 0.5);
      recordDailyCost("2025-01-15", "claude-opus-4-20250514", 1.0);
      const history = getDailyCostHistory();
      expect(history).toHaveLength(1);
      expect(history[0].totalCost).toBe(1.5);
      expect(history[0].requests).toBe(2);
    });

    it("harus track cost per model di daily entry", () => {
      recordDailyCost("2025-01-15", "sonnet", 0.5);
      recordDailyCost("2025-01-15", "opus", 1.0);
      const history = getDailyCostHistory();
      expect(history[0].byModel["sonnet"]).toBe(0.5);
      expect(history[0].byModel["opus"]).toBe(1.0);
    });
  });

  describe("getDailyCostHistory()", () => {
    it("harus return sorted by date", () => {
      recordDailyCost("2025-01-17", "m", 0.3);
      recordDailyCost("2025-01-15", "m", 0.1);
      recordDailyCost("2025-01-16", "m", 0.2);
      const history = getDailyCostHistory();
      expect(history[0].date).toBe("2025-01-15");
      expect(history[1].date).toBe("2025-01-16");
      expect(history[2].date).toBe("2025-01-17");
    });

    it("harus limit ke N days terakhir", () => {
      for (let i = 1; i <= 40; i++) {
        const day = String(i).padStart(2, "0");
        recordDailyCost(`2025-02-${day}`, "m", 0.1);
      }
      const history = getDailyCostHistory(10);
      expect(history).toHaveLength(10);
    });
  });

  describe("getTodayCost()", () => {
    it("harus return 0 saat tidak ada data hari ini", () => {
      expect(getTodayCost()).toBe(0);
    });

    it("harus return cost hari ini", () => {
      const today = new Date().toISOString().slice(0, 10);
      recordDailyCost(today, "sonnet", 1.5);
      expect(getTodayCost()).toBe(1.5);
    });
  });

  describe("clearDailyCosts()", () => {
    it("harus clear semua daily costs", () => {
      recordDailyCost("2025-01-15", "m", 0.5);
      clearDailyCosts();
      expect(getDailyCostHistory()).toHaveLength(0);
    });
  });
});
