import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { loadConfig } from "./lib/config";
import { AccountManager } from "./lib/account-manager";
import { ProxyHandler } from "./lib/proxy";
import { setLogLevel, logger } from "./lib/logger";
import { loggerMiddleware } from "./middleware/logger";
import { errorHandler } from "./middleware/error-handler";
import { createAuthMiddleware, createDashboardAuth } from "./middleware/auth";
import { createApiRoutes } from "./routes/api";
import { createHealthRoutes } from "./routes/health";
import { createDashboardApiRoutes } from "./routes/dashboard-api";
import { createDashboardRoutes } from "./routes/dashboard";
import type { LogLevel } from "./lib/logger";

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel as LogLevel);

  logger.info("Starting Claude API Pool", {
    port: config.port,
    strategy: config.poolStrategy,
    maxRetries: config.maxRetries,
  });

  const manager = new AccountManager(config);
  await manager.initialize();

  const proxy = new ProxyHandler(manager, config);

  const app = new Hono();

  app.use("*", cors());
  app.use("*", errorHandler);
  app.use("*", loggerMiddleware);

  const healthRoutes = createHealthRoutes(manager);
  app.route("/", healthRoutes);

  const dashboardAuth = createDashboardAuth(config);
  const dashboardRoutes = createDashboardRoutes();
  app.use("/dashboard/*", dashboardAuth);
  app.route("/", dashboardRoutes);

  const apiAuth = createAuthMiddleware(config);
  const dashboardApiRoutes = createDashboardApiRoutes(manager, config);
  app.use("/api/*", apiAuth);
  app.route("/", dashboardApiRoutes);

  const apiRoutes = createApiRoutes(proxy);
  app.route("/", apiRoutes);

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    (info) => {
      logger.info(`Server running on http://${config.host}:${info.port}`);
      logger.info(`Dashboard: http://localhost:${info.port}/dashboard`);
      logger.info(`Proxy: http://localhost:${info.port}/v1/messages`);
    },
  );

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await manager.shutdown();
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err.message });
    shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
