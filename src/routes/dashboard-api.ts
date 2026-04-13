import { Hono } from "hono";
import type { AccountManager } from "~/lib/account-manager";
import type { AppConfig } from "~/lib/types";
import { getRecentLogs } from "~/lib/metrics";

export function createDashboardApiRoutes(
  manager: AccountManager,
  config: AppConfig,
): Hono {
  const app = new Hono();

  app.get("/api/dashboard/stats", (c) => {
    const metrics = manager.getPoolMetrics();
    return c.json({ status: "ok", ...metrics });
  });

  app.get("/api/dashboard/accounts", (c) => {
    const accounts = manager.getAllAccounts();
    return c.json({ status: "ok", accounts });
  });

  app.get("/api/dashboard/accounts/:id", (c) => {
    const id = c.req.param("id");
    const account = manager.getAccount(id);
    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }
    return c.json({ status: "ok", account });
  });

  app.post("/api/dashboard/accounts", async (c) => {
    const body = await c.req.json();
    const account = await manager.addAccount({
      name: body.name,
      apiKey: body.apiKey,
      priority: body.priority,
      weight: body.weight,
    });
    return c.json({ status: "ok", account }, 201);
  });

  app.put("/api/dashboard/accounts/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const account = await manager.updateAccount(id, {
      name: body.name,
      priority: body.priority,
      weight: body.weight,
    });
    return c.json({ status: "ok", account });
  });

  app.delete("/api/dashboard/accounts/:id", async (c) => {
    const id = c.req.param("id");
    await manager.removeAccount(id);
    return c.json({ status: "ok", message: "Account removed" });
  });

  app.post("/api/dashboard/accounts/:id/disable", async (c) => {
    const id = c.req.param("id");
    await manager.disableAccount(id);
    return c.json({ status: "ok", message: "Account disabled" });
  });

  app.post("/api/dashboard/accounts/:id/enable", async (c) => {
    const id = c.req.param("id");
    await manager.enableAccount(id);
    return c.json({ status: "ok", message: "Account enabled" });
  });

  app.post("/api/dashboard/accounts/:id/reset-rate-limit", async (c) => {
    const id = c.req.param("id");
    await manager.resetRateLimit(id);
    return c.json({ status: "ok", message: "Rate limit reset" });
  });

  app.get("/api/dashboard/metrics", (c) => {
    const metrics = manager.getPoolMetrics();
    return c.json({ status: "ok", metrics });
  });

  app.get("/api/dashboard/logs", (c) => {
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const logs = getRecentLogs(limit);
    return c.json({ status: "ok", logs });
  });

  app.get("/api/dashboard/config", (c) => {
    return c.json({
      status: "ok",
      config: {
        strategy: manager.getStrategy(),
        maxRetries: config.maxRetries,
        rateLimitCooldown: config.rateLimitCooldown,
        healthCheckInterval: config.poolHealthCheckInterval,
      },
    });
  });

  app.put("/api/dashboard/config", async (c) => {
    const body = await c.req.json();
    if (body.strategy) {
      manager.setStrategy(body.strategy);
    }
    return c.json({ status: "ok", message: "Config updated" });
  });

  return app;
}
