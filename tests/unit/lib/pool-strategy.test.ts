import { describe, it, expect } from "vitest";
import {
  selectByRoundRobin,
  selectByWeightedRoundRobin,
  selectByLeastUsed,
  selectByPriority,
  selectByRandom,
  selectAccount,
} from "~/lib/pool-strategy";
import type { ApiKeyAccount } from "~/lib/types";

function makeAccount(overrides: Partial<ApiKeyAccount> = {}): ApiKeyAccount {
  return {
    id: overrides.id || "test-id",
    name: overrides.name || "test",
    apiKey: "sk-ant-test",
    status: overrides.status || "active",
    usage: overrides.usage || { total: 0, success: 0, failed: 0 },
    rateLimit: overrides.rateLimit || { hit: 0, resetAt: null },
    metadata: overrides.metadata || {
      createdAt: Date.now(),
      lastUsedAt: null,
      priority: 50,
      weight: 1,
    },
    health: overrides.health || { consecutiveFailures: 0, lastCheckAt: null },
    inFlight: overrides.inFlight ?? 0,
  };
}

describe("PoolStrategy", () => {
  describe("RoundRobinStrategy", () => {
    it("harus return accounts secara berurutan", () => {
      const accounts = [
        makeAccount({ id: "a", name: "a" }),
        makeAccount({ id: "b", name: "b" }),
        makeAccount({ id: "c", name: "c" }),
      ];
      const r1 = selectByRoundRobin({ accounts, currentIndex: 0 });
      expect(r1.account?.id).toBe("a");
      const r2 = selectByRoundRobin({ accounts, currentIndex: r1.nextIndex });
      expect(r2.account?.id).toBe("b");
      const r3 = selectByRoundRobin({ accounts, currentIndex: r2.nextIndex });
      expect(r3.account?.id).toBe("c");
    });

    it("harus skip account yang tidak active", () => {
      const accounts = [
        makeAccount({ id: "a", status: "rate_limited" }),
        makeAccount({ id: "b", status: "active" }),
        makeAccount({ id: "c", status: "disabled" }),
      ];
      const r1 = selectByRoundRobin({ accounts, currentIndex: 0 });
      expect(r1.account?.id).toBe("b");
    });

    it("harus wrap-around ke awal setelah akhir", () => {
      const accounts = [makeAccount({ id: "a" }), makeAccount({ id: "b" })];
      const r1 = selectByRoundRobin({ accounts, currentIndex: 0 });
      const r2 = selectByRoundRobin({ accounts, currentIndex: r1.nextIndex });
      const r3 = selectByRoundRobin({ accounts, currentIndex: r2.nextIndex });
      expect(r3.account?.id).toBe("a");
    });

    it("harus handle pool dengan satu account", () => {
      const accounts = [makeAccount({ id: "only" })];
      const r1 = selectByRoundRobin({ accounts, currentIndex: 0 });
      expect(r1.account?.id).toBe("only");
      const r2 = selectByRoundRobin({ accounts, currentIndex: r1.nextIndex });
      expect(r2.account?.id).toBe("only");
    });

    it("harus handle pool kosong", () => {
      const result = selectByRoundRobin({ accounts: [], currentIndex: 0 });
      expect(result.account).toBeNull();
    });

    it("harus return null jika semua account tidak active", () => {
      const accounts = [
        makeAccount({ id: "a", status: "rate_limited" }),
        makeAccount({ id: "b", status: "invalid" }),
        makeAccount({ id: "c", status: "disabled" }),
      ];
      const result = selectByRoundRobin({ accounts, currentIndex: 0 });
      expect(result.account).toBeNull();
    });
  });

  describe("WeightedRoundRobinStrategy", () => {
    it("harus distribute request sesuai weight", () => {
      const accounts = [
        makeAccount({
          id: "a",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 50, weight: 2 },
        }),
        makeAccount({
          id: "b",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 50, weight: 1 },
        }),
      ];

      const selections: string[] = [];
      let idx = 0;
      for (let i = 0; i < 6; i++) {
        const result = selectByWeightedRoundRobin({
          accounts,
          currentIndex: idx,
        });
        if (result.account) selections.push(result.account.id);
        idx = result.nextIndex;
      }

      const countA = selections.filter((s) => s === "a").length;
      const countB = selections.filter((s) => s === "b").length;
      expect(countA).toBe(4);
      expect(countB).toBe(2);
    });

    it("harus skip account yang tidak active meskipun weight tinggi", () => {
      const accounts = [
        makeAccount({
          id: "a",
          status: "disabled",
          metadata: {
            createdAt: 0,
            lastUsedAt: null,
            priority: 50,
            weight: 10,
          },
        }),
        makeAccount({
          id: "b",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 50, weight: 1 },
        }),
      ];
      const result = selectByWeightedRoundRobin({
        accounts,
        currentIndex: 0,
      });
      expect(result.account?.id).toBe("b");
    });

    it("harus handle semua weight 0", () => {
      const accounts = [
        makeAccount({
          id: "a",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 50, weight: 0 },
        }),
      ];
      const result = selectByWeightedRoundRobin({
        accounts,
        currentIndex: 0,
      });
      expect(result.account).toBeNull();
    });

    it("harus handle pool kosong", () => {
      const result = selectByWeightedRoundRobin({
        accounts: [],
        currentIndex: 0,
      });
      expect(result.account).toBeNull();
    });
  });

  describe("LeastUsedStrategy", () => {
    it("harus return account dengan in-flight paling sedikit", () => {
      const accounts = [
        makeAccount({ id: "a", inFlight: 5 }),
        makeAccount({ id: "b", inFlight: 1 }),
        makeAccount({ id: "c", inFlight: 3 }),
      ];
      const result = selectByLeastUsed({ accounts, currentIndex: 0 });
      expect(result.account?.id).toBe("b");
    });

    it("harus handle tie dengan total usage lebih rendah", () => {
      const accounts = [
        makeAccount({
          id: "a",
          inFlight: 0,
          usage: { total: 100, success: 100, failed: 0 },
        }),
        makeAccount({
          id: "b",
          inFlight: 0,
          usage: { total: 10, success: 10, failed: 0 },
        }),
      ];
      const result = selectByLeastUsed({ accounts, currentIndex: 0 });
      expect(result.account?.id).toBe("b");
    });

    it("harus skip account inactive", () => {
      const accounts = [
        makeAccount({ id: "a", inFlight: 0, status: "rate_limited" }),
        makeAccount({ id: "b", inFlight: 5 }),
      ];
      const result = selectByLeastUsed({ accounts, currentIndex: 0 });
      expect(result.account?.id).toBe("b");
    });

    it("harus handle pool kosong", () => {
      const result = selectByLeastUsed({ accounts: [], currentIndex: 0 });
      expect(result.account).toBeNull();
    });
  });

  describe("PriorityStrategy", () => {
    it("harus return account dengan priority tertinggi", () => {
      const accounts = [
        makeAccount({
          id: "a",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 30, weight: 1 },
        }),
        makeAccount({
          id: "b",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 90, weight: 1 },
        }),
        makeAccount({
          id: "c",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 50, weight: 1 },
        }),
      ];
      const result = selectByPriority({ accounts, currentIndex: 0 });
      expect(result.account?.id).toBe("b");
    });

    it("harus fallback ke priority lebih rendah jika tinggi tidak available", () => {
      const accounts = [
        makeAccount({
          id: "a",
          status: "disabled",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 90, weight: 1 },
        }),
        makeAccount({
          id: "b",
          metadata: { createdAt: 0, lastUsedAt: null, priority: 50, weight: 1 },
        }),
      ];
      const result = selectByPriority({ accounts, currentIndex: 0 });
      expect(result.account?.id).toBe("b");
    });

    it("harus return null jika tidak ada yang available", () => {
      const accounts = [makeAccount({ id: "a", status: "disabled" })];
      const result = selectByPriority({ accounts, currentIndex: 0 });
      expect(result.account).toBeNull();
    });

    it("harus handle pool kosong", () => {
      const result = selectByPriority({ accounts: [], currentIndex: 0 });
      expect(result.account).toBeNull();
    });
  });

  describe("RandomStrategy", () => {
    it("harus return account dari pool active", () => {
      const accounts = [
        makeAccount({ id: "a" }),
        makeAccount({ id: "b" }),
        makeAccount({ id: "c" }),
      ];
      const result = selectByRandom({ accounts, currentIndex: 0 });
      expect(result.account).not.toBeNull();
      expect(["a", "b", "c"]).toContain(result.account?.id);
    });

    it("harus skip inactive accounts", () => {
      const accounts = [
        makeAccount({ id: "a", status: "disabled" }),
        makeAccount({ id: "b" }),
      ];
      const result = selectByRandom({ accounts, currentIndex: 0 });
      expect(result.account?.id).toBe("b");
    });

    it("harus handle pool kosong", () => {
      const result = selectByRandom({ accounts: [], currentIndex: 0 });
      expect(result.account).toBeNull();
    });
  });

  describe("selectAccount (dispatcher)", () => {
    it("harus dispatch ke strategy yang benar", () => {
      const accounts = [makeAccount({ id: "a" })];
      const result = selectAccount("round-robin", {
        accounts,
        currentIndex: 0,
      });
      expect(result.account?.id).toBe("a");
    });

    it("harus throw error untuk strategy tidak dikenal", () => {
      expect(() =>
        selectAccount("unknown" as any, { accounts: [], currentIndex: 0 }),
      ).toThrow("Unknown pool strategy");
    });
  });
});
