import type { Context, Next } from "hono";
import type { AppConfig } from "~/lib/types";

export function createAuthMiddleware(config: AppConfig) {
  return async function authMiddleware(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    if (!config.apiSecretKey) {
      await next();
      return;
    }

    const authHeader = c.req.header("authorization");
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token === config.apiSecretKey) {
        await next();
        return;
      }
    }

    const apiKey = c.req.header("x-api-key");
    if (apiKey === config.apiSecretKey) {
      await next();
      return;
    }

    return c.json(
      { error: { type: "authentication_error", message: "Invalid API key" } },
      401,
    );
  };
}

export function createDashboardAuth(config: AppConfig) {
  return async function dashboardAuth(
    c: Context,
    next: Next,
  ): Promise<Response | void> {
    if (!config.dashboardPassword) {
      await next();
      return;
    }

    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      c.header("WWW-Authenticate", 'Basic realm="Claude API Dashboard"');
      return c.text("Unauthorized", 401);
    }

    const decoded = Buffer.from(authHeader.slice(6), "base64").toString(
      "utf-8",
    );
    const [username, password] = decoded.split(":");

    if (
      username === config.dashboardUsername &&
      password === config.dashboardPassword
    ) {
      await next();
      return;
    }

    c.header("WWW-Authenticate", 'Basic realm="Claude API Dashboard"');
    return c.text("Unauthorized", 401);
  };
}
