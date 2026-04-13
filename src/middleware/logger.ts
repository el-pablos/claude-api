import type { Context, Next } from "hono";
import { logger as log } from "~/lib/logger";
import { randomUUID } from "node:crypto";

export async function loggerMiddleware(c: Context, next: Next): Promise<void> {
  const requestId = c.req.header("x-request-id") || randomUUID();
  c.set("requestId", requestId);
  const start = Date.now();

  log.info("Incoming request", {
    requestId,
    method: c.req.method,
    path: c.req.path,
  });

  await next();

  const duration = Date.now() - start;
  log.info("Response sent", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    statusCode: c.res.status,
    durationMs: duration,
  });
}
