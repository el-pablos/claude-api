import { Hono } from "hono";
import type { AccountManager } from "~/lib/account-manager";

export function createHealthRoutes(manager: AccountManager): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/health/detailed", (c) => {
    const metrics = manager.getPoolMetrics();
    const poolStatus =
      metrics.active > 0
        ? "healthy"
        : metrics.rateLimited > 0
          ? "degraded"
          : "down";

    return c.json({
      status: "ok",
      pool: {
        status: poolStatus,
        ...metrics,
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health/live", (c) => {
    return c.text("OK", 200);
  });

  app.get("/health/ready", (c) => {
    const hasAccounts = manager.hasAvailableAccounts();
    if (hasAccounts) {
      return c.text("OK", 200);
    }
    return c.text("Not Ready", 503);
  });

  return app;
}
