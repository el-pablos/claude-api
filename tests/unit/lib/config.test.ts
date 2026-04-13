import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfig } from "~/lib/config";

describe("config", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetConfig();
  });

  it("harus return default values jika env kosong", () => {
    delete process.env.PORT;
    delete process.env.POOL_STRATEGY;
    const config = loadConfig();
    expect(config.port).toBe(4143);
    expect(config.poolStrategy).toBe("round-robin");
    expect(config.maxRetries).toBe(3);
    expect(config.claudeBaseUrl).toBe("https://api.anthropic.com");
  });

  it("harus parse PORT dari env", () => {
    process.env.PORT = "8080";
    const config = loadConfig();
    expect(config.port).toBe(8080);
  });

  it("harus parse POOL_STRATEGY dari env", () => {
    process.env.POOL_STRATEGY = "weighted";
    const config = loadConfig();
    expect(config.poolStrategy).toBe("weighted");
  });

  it("harus throw error untuk strategy invalid", () => {
    process.env.POOL_STRATEGY = "nonexistent";
    expect(() => loadConfig()).toThrow("Invalid POOL_STRATEGY");
  });

  it("harus parse semua strategy valid", () => {
    for (const s of [
      "round-robin",
      "weighted",
      "least-used",
      "priority",
      "random",
    ]) {
      process.env.POOL_STRATEGY = s;
      resetConfig();
      const config = loadConfig();
      expect(config.poolStrategy).toBe(s);
    }
  });

  it("harus parse boolean DASHBOARD_ENABLED", () => {
    process.env.DASHBOARD_ENABLED = "false";
    const config = loadConfig();
    expect(config.dashboardEnabled).toBe(false);
  });

  it("harus parse numeric values", () => {
    process.env.MAX_RETRIES = "5";
    process.env.RATE_LIMIT_COOLDOWN = "120000";
    const config = loadConfig();
    expect(config.maxRetries).toBe(5);
    expect(config.rateLimitCooldown).toBe(120000);
  });
});
