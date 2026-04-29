import type { Context, Next } from "hono";
import type { AppConfig } from "~/lib/types";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  // timingSafeEqual butuh dua buffer dengan length sama. Kalau beda length,
  // langsung return false tapi tetap comparable buffer length-nya.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // dummy compare supaya runtime constant terhadap input length yang sama
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

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
      if (safeEqual(token, config.apiSecretKey)) {
        await next();
        return;
      }
    }

    const apiKey = c.req.header("x-api-key");
    if (apiKey && safeEqual(apiKey, config.apiSecretKey)) {
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
    const sepIdx = decoded.indexOf(":");
    const username = sepIdx >= 0 ? decoded.slice(0, sepIdx) : decoded;
    const password = sepIdx >= 0 ? decoded.slice(sepIdx + 1) : "";

    if (
      safeEqual(username, config.dashboardUsername) &&
      safeEqual(password, config.dashboardPassword)
    ) {
      await next();
      return;
    }

    c.header("WWW-Authenticate", 'Basic realm="Claude API Dashboard"');
    return c.text("Unauthorized", 401);
  };
}
