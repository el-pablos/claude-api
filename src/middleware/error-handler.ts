import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { logger } from "~/lib/logger";

function mapErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 429) return "rate_limit_error";
  if (status === 503) return "overloaded_error";
  return "api_error";
}

/**
 * Hono `app.onError(...)` handler. Dipake langsung di index.ts:
 * `app.onError(errorHandler);` — jangan dipasang sebagai `app.use(...)`
 * karena Hono ngecatch error di compose layer-nya sendiri sebelum
 * sampai ke middleware berikutnya.
 */
export function errorHandler(err: Error, c: Context): Response {
  const error = err as Error & { status?: number };
  const status = error.status || 500;
  const requestId = c.get("requestId") || "unknown";

  logger.error("Unhandled error", {
    requestId,
    error: error.message,
    statusCode: status,
    path: c.req.path,
  });

  return c.json(
    {
      type: "error",
      error: {
        type: mapErrorType(status),
        message: error.message || "Internal server error",
      },
    },
    status as ContentfulStatusCode,
  );
}
