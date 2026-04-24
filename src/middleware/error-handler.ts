import type { Context, Next } from "hono";
import { logger } from "~/lib/logger";

export async function errorHandler(
  c: Context,
  next: Next,
): Promise<Response | void> {
  try {
    await next();
  } catch (err) {
    const error = err as Error & { status?: number };
    const status = error.status || 500;
    const requestId = c.get("requestId") || "unknown";

    logger.error("Unhandled error", {
      requestId,
      error: error.message,
      statusCode: status,
      path: c.req.path,
    });

    c.status(status as 200);
    c.header("content-type", "application/json");
    const body = JSON.stringify({
      type: "error",
      error: {
        type: status === 503 ? "overloaded_error" : "api_error",
        message: error.message || "Internal server error",
      },
    });
    return c.body(body);
  }
}
