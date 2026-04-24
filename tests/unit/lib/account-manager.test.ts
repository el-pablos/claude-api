import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AccountManager } from "~/lib/account-manager";
import type { AppConfig } from "~/lib/types";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("~/lib/oauth", () => {
  const pendingAuths = new Map();
  let counter = 0;
  return {
    startAuth: vi.fn((name: string) => {
      counter++;
      const state = `test-state-${counter}`;
      const pending = {
        challenge: {
          codeVerifier: `verifier-${counter}`,
          codeChallenge: `challenge-${counter}`,
          state,
        },
        authorizeUrl: `https://claude.com/cai/oauth/authorize?state=${state}`,
        createdAt: Date.now(),
        accountName: name,
      };
      pendingAuths.set(state, pending);
      return pending;
    }),
    getPendingAuth: vi.fn((state: string) => pendingAuths.get(state) || null),
    getLatestPendingAuth: vi.fn(() => {
      let latest = null;
      for (const p of pendingAuths.values()) {
        if (!latest || p.createdAt > latest.createdAt) latest = p;
      }
      return latest;
    }),
    removePendingAuth: vi.fn((state: string) => pendingAuths.delete(state)),
    getPendingAuthCount: vi.fn(() => pendingAuths.size),
    exchangeCodeForTokens: vi.fn(async () => ({
      accessToken: `access-token-${Date.now()}`,
      refreshToken: `refresh-token-${Date.now()}`,
      expiresAt: Date.now() + 3600_000,
    })),
    refreshAccessToken: vi.fn(async () => ({
      accessToken: `refreshed-token-${Date.now()}`,
      refreshToken: `refresh-token-${Date.now()}`,
      expiresAt: Date.now() + 3600_000,
    })),
    isTokenExpiringSoon: vi.fn(() => false),
  };
});

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 4143,
    host: "0.0.0.0",
    nodeEnv: "test",
    apiSecretKey: "test-secret",
    encryptionKey: "test-encryption-key-32-chars-ok!",
    poolStrategy: "round-robin",
    poolStateFile: path.join(os.tmpdir(), `claude-api-test-${Date.now()}.json`),
    poolHealthCheckInterval: 60000,
    rateLimitCooldown: 60000,
    rateLimitMaxConsecutive: 3,
    maxRetries: 3,
    retryDelayBase: 1000,
    retryDelayMax: 30000,
    claudeBaseUrl: "https://api.anthropic.com",
    claudeApiTimeout: 300000,
    logLevel: "error",
    dashboardEnabled: true,
    dashboardUsername: "admin",
    dashboardPassword: "",
    ...overrides,
  };
}

import { startAuth } from "~/lib/oauth";

async function addTestAccount(
  manager: AccountManager,
  name: string,
  opts?: { priority?: number; weight?: number },
) {
  const pending = startAuth(name);
  return manager.addAccount({
    name,
    oauthCode: `code-for-${name}`,
    state: pending.challenge.state,
    priority: opts?.priority,
    weight: opts?.weight,
  });
}

describe("AccountManager", () => {
  let manager: AccountManager;
  let config: AppConfig;

  beforeEach(async () => {
    config = makeConfig();
    manager = new AccountManager(config);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      await fs.unlink(config.poolStateFile);
    } catch {}
  });

  describe("initialize()", () => {
    it("harus load accounts dari storage saat inisialisasi", async () => {
      const state = {
        accounts: [],
        currentIndex: 0,
        lastSelectedId: null,
        config: { strategy: "round-robin" },
      };
      await fs.writeFile(config.poolStateFile, JSON.stringify(state));

      const m2 = new AccountManager(config);
      await m2.initialize();
      expect(m2.getAllAccounts()).toHaveLength(0);
      await m2.shutdown();
    });

    it("harus handle storage kosong (fresh start)", () => {
      expect(manager.getAllAccounts()).toHaveLength(0);
      expect(manager.hasAvailableAccounts()).toBe(false);
    });

    it("harus handle storage corrupt", async () => {
      await fs.writeFile(config.poolStateFile, "not-json{{{");
      const m2 = new AccountManager(config);
      await m2.initialize();
      expect(m2.getAllAccounts()).toHaveLength(0);
      await m2.shutdown();
    });

    it("harus emit initialized event", async () => {
      const m2 = new AccountManager(makeConfig());
      const spy = vi.fn();
      m2.on("initialized", spy);
      await m2.initialize();
      expect(spy).toHaveBeenCalledOnce();
      await m2.shutdown();
    });
  });

  describe("addAccount()", () => {
    it("harus berhasil menambah account baru via oauth", async () => {
      const account = await addTestAccount(manager, "test-account");
      expect(account.id).toBeDefined();
      expect(account.name).toBe("test-account");
      expect(account.status).toBe("active");
      expect(manager.getAllAccounts()).toHaveLength(1);
    });

    it("harus throw error jika oauth code kosong", async () => {
      startAuth("test");
      await expect(
        manager.addAccount({ name: "test", oauthCode: "" }),
      ).rejects.toThrow("OAuth authorization code is required");
    });

    it("harus throw error jika name kosong", async () => {
      startAuth("test");
      await expect(
        manager.addAccount({ name: "", oauthCode: "test-code" }),
      ).rejects.toThrow("Account name is required");
    });

    it("harus throw error jika tidak ada pending auth", async () => {
      await expect(
        manager.addAccount({
          name: "test",
          oauthCode: "code",
          state: "nonexistent-state",
        }),
      ).rejects.toThrow("No pending OAuth session");
    });

    it("harus assign UUID unik", async () => {
      const a1 = await addTestAccount(manager, "k1");
      const a2 = await addTestAccount(manager, "k2");
      expect(a1.id).not.toBe(a2.id);
    });

    it("harus set default priority dan weight", async () => {
      const account = await addTestAccount(manager, "test");
      expect(account.metadata.priority).toBe(50);
      expect(account.metadata.weight).toBe(1);
    });

    it("harus accept custom priority dan weight", async () => {
      const account = await addTestAccount(manager, "test", {
        priority: 90,
        weight: 5,
      });
      expect(account.metadata.priority).toBe(90);
      expect(account.metadata.weight).toBe(5);
    });

    it("harus encrypt oauth tokens", async () => {
      await addTestAccount(manager, "test");
      const state = manager.getState();
      const rawToken = state.accounts[0].oauth.accessToken;
      expect(rawToken).toContain(":");
    });

    it("harus emit account:added event", async () => {
      const spy = vi.fn();
      manager.on("account:added", spy);
      await addTestAccount(manager, "test");
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("removeAccount()", () => {
    it("harus remove account dari pool", async () => {
      const account = await addTestAccount(manager, "test");
      await manager.removeAccount(account.id);
      expect(manager.getAllAccounts()).toHaveLength(0);
    });

    it("harus throw error jika account tidak ditemukan", async () => {
      await expect(manager.removeAccount("nonexistent")).rejects.toThrow(
        "Account not found",
      );
    });

    it("harus emit account:removed event", async () => {
      const spy = vi.fn();
      manager.on("account:removed", spy);
      const account = await addTestAccount(manager, "test");
      await manager.removeAccount(account.id);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("getNextAccount()", () => {
    it("harus return null jika pool kosong", () => {
      expect(manager.getNextAccount()).toBeNull();
    });

    it("harus return null jika semua account tidak active", async () => {
      const a = await addTestAccount(manager, "test");
      await manager.disableAccount(a.id);
      expect(manager.getNextAccount()).toBeNull();
    });

    it("harus skip account rate_limited", async () => {
      const a1 = await addTestAccount(manager, "k1");
      const a2 = await addTestAccount(manager, "k2");
      manager.markRateLimited(a1.id);
      const selected = manager.getNextAccount();
      expect(selected?.id).toBe(a2.id);
    });

    it("harus skip account invalid", async () => {
      const a1 = await addTestAccount(manager, "k1");
      const a2 = await addTestAccount(manager, "k2");
      manager.markInvalid(a1.id);
      const selected = manager.getNextAccount();
      expect(selected?.id).toBe(a2.id);
    });

    it("harus skip account disabled", async () => {
      const a1 = await addTestAccount(manager, "k1");
      const a2 = await addTestAccount(manager, "k2");
      await manager.disableAccount(a1.id);
      const selected = manager.getNextAccount();
      expect(selected?.id).toBe(a2.id);
    });

    it("harus round-robin dengan benar", async () => {
      await addTestAccount(manager, "k1");
      await addTestAccount(manager, "k2");
      await addTestAccount(manager, "k3");

      const names = [];
      for (let i = 0; i < 6; i++) {
        const acc = manager.getNextAccount();
        names.push(acc?.name);
      }
      expect(names).toEqual(["k1", "k2", "k3", "k1", "k2", "k3"]);
    });
  });

  describe("markRateLimited()", () => {
    it("harus ubah status ke rate_limited", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markRateLimited(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.status).toBe("rate_limited");
    });

    it("harus set resetAt", async () => {
      const account = await addTestAccount(manager, "test");
      const resetAt = Date.now() + 30000;
      manager.markRateLimited(account.id, resetAt);
      const updated = manager.getAccount(account.id);
      expect(updated?.rateLimit.resetAt).toBe(resetAt);
    });

    it("harus increment hit count", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markRateLimited(account.id);
      manager.markRateLimited(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.rateLimit.hit).toBe(2);
    });

    it("harus throw error jika account tidak ditemukan", () => {
      expect(() => manager.markRateLimited("nonexistent")).toThrow(
        "Account not found",
      );
    });

    it("harus emit account:rate-limited event", async () => {
      const spy = vi.fn();
      manager.on("account:rate-limited", spy);
      const account = await addTestAccount(manager, "test");
      manager.markRateLimited(account.id);
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("markSuccess()", () => {
    it("harus increment usage counters", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markSuccess(account.id);
      manager.markSuccess(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.usage.total).toBe(2);
      expect(updated?.usage.success).toBe(2);
    });

    it("harus update lastUsedAt", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markSuccess(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.metadata.lastUsedAt).toBeGreaterThan(0);
    });

    it("harus reset consecutiveFailures", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markFailed(account.id, new Error("err"));
      manager.markFailed(account.id, new Error("err"));
      manager.markSuccess(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.health.consecutiveFailures).toBe(0);
    });
  });

  describe("markFailed()", () => {
    it("harus increment failure counters", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markFailed(account.id, new Error("err"));
      const updated = manager.getAccount(account.id);
      expect(updated?.usage.total).toBe(1);
      expect(updated?.usage.failed).toBe(1);
      expect(updated?.health.consecutiveFailures).toBe(1);
    });

    it("harus auto-invalidate setelah consecutive failures >= threshold", async () => {
      const account = await addTestAccount(manager, "test");
      for (let i = 0; i < config.rateLimitMaxConsecutive; i++) {
        manager.markFailed(account.id, new Error("err"));
      }
      const updated = manager.getAccount(account.id);
      expect(updated?.status).toBe("invalid");
    });

    it("harus throw error jika account tidak ditemukan", () => {
      expect(() => manager.markFailed("nonexistent", new Error("err"))).toThrow(
        "Account not found",
      );
    });
  });

  describe("disableAccount() / enableAccount()", () => {
    it("harus disable account", async () => {
      const account = await addTestAccount(manager, "test");
      await manager.disableAccount(account.id);
      expect(manager.getAccount(account.id)?.status).toBe("disabled");
    });

    it("harus enable account dan reset failures", async () => {
      const account = await addTestAccount(manager, "test");
      await manager.disableAccount(account.id);
      await manager.enableAccount(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.status).toBe("active");
      expect(updated?.health.consecutiveFailures).toBe(0);
    });
  });

  describe("resetRateLimit()", () => {
    it("harus reset rate limit dan set status active", async () => {
      const account = await addTestAccount(manager, "test");
      manager.markRateLimited(account.id);
      await manager.resetRateLimit(account.id);
      const updated = manager.getAccount(account.id);
      expect(updated?.status).toBe("active");
      expect(updated?.rateLimit.resetAt).toBeNull();
    });
  });

  describe("getPoolMetrics()", () => {
    it("harus return metrics yang akurat", async () => {
      await addTestAccount(manager, "k1");
      const a2 = await addTestAccount(manager, "k2");
      const a3 = await addTestAccount(manager, "k3");

      manager.markRateLimited(a2.id);
      await manager.disableAccount(a3.id);

      const metrics = manager.getPoolMetrics();
      expect(metrics.total).toBe(3);
      expect(metrics.active).toBe(1);
      expect(metrics.rateLimited).toBe(1);
      expect(metrics.disabled).toBe(1);
    });
  });

  describe("updateAccount()", () => {
    it("harus update name, priority, weight", async () => {
      const account = await addTestAccount(manager, "old");
      const updated = await manager.updateAccount(account.id, {
        name: "new-name",
        priority: 99,
        weight: 5,
      });
      expect(updated.name).toBe("new-name");
      expect(updated.metadata.priority).toBe(99);
      expect(updated.metadata.weight).toBe(5);
    });

    it("harus throw error jika account tidak ditemukan", async () => {
      await expect(
        manager.updateAccount("nonexistent", { name: "test" }),
      ).rejects.toThrow("Account not found");
    });
  });

  describe("hasAvailableAccounts()", () => {
    it("harus return false saat pool kosong", () => {
      expect(manager.hasAvailableAccounts()).toBe(false);
    });

    it("harus return true saat ada account active", async () => {
      await addTestAccount(manager, "test");
      expect(manager.hasAvailableAccounts()).toBe(true);
    });

    it("harus return false saat semua disabled", async () => {
      const a = await addTestAccount(manager, "test");
      await manager.disableAccount(a.id);
      expect(manager.hasAvailableAccounts()).toBe(false);
    });
  });

  describe("inFlight tracking", () => {
    it("harus increment dan decrement inFlight", async () => {
      const account = await addTestAccount(manager, "test");
      manager.incrementInFlight(account.id);
      manager.incrementInFlight(account.id);
      expect(manager.getAccount(account.id)?.inFlight).toBe(2);
      manager.decrementInFlight(account.id);
      expect(manager.getAccount(account.id)?.inFlight).toBe(1);
    });

    it("harus tidak go below 0", async () => {
      const account = await addTestAccount(manager, "test");
      manager.decrementInFlight(account.id);
      expect(manager.getAccount(account.id)?.inFlight).toBe(0);
    });
  });

  describe("sanitizeAccount()", () => {
    it("harus mask oauth tokens di getAllAccounts", async () => {
      await addTestAccount(manager, "test");
      const accounts = manager.getAllAccounts();
      expect(accounts[0].oauth.accessToken).toContain("...");
      expect(accounts[0].oauth.refreshToken).toBe("***");
    });
  });
});
