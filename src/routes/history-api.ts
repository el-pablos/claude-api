import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getHistory,
  getHistoryStats,
  clearHistory,
  onHistoryEntry,
} from "~/lib/request-history";
import type { HistoryEntry } from "~/lib/types";

export function createHistoryApiRoutes(): Hono {
  const app = new Hono();

  app.get("/api/dashboard/history", (c) => {
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    const model = c.req.query("model") || undefined;
    const status = c.req.query("status") || undefined;
    const accountId = c.req.query("accountId") || undefined;

    const result = getHistory({ limit, offset, model, status, accountId });

    return c.json({
      status: "ok",
      ...result,
    });
  });

  app.get("/api/dashboard/history/stats", (c) => {
    const stats = getHistoryStats();
    return c.json({
      status: "ok",
      stats,
    });
  });

  app.delete("/api/dashboard/history", (c) => {
    clearHistory();
    return c.json({
      status: "ok",
      message: "History cleared",
    });
  });

  app.get("/api/dashboard/history/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let alive = true;

      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          message: "History stream connected",
          timestamp: Date.now(),
        }),
      });

      const removeListener = onHistoryEntry((entry: HistoryEntry) => {
        if (!alive) return;
        stream
          .writeSSE({
            event: "entry",
            data: JSON.stringify(entry),
          })
          .catch(() => {
            alive = false;
          });
      });

      const heartbeatInterval = setInterval(() => {
        if (!alive) {
          clearInterval(heartbeatInterval);
          return;
        }
        stream
          .writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          })
          .catch(() => {
            alive = false;
            clearInterval(heartbeatInterval);
          });
      }, 5000);

      stream.onAbort(() => {
        alive = false;
        clearInterval(heartbeatInterval);
        removeListener();
      });

      while (alive) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    });
  });

  return app;
}
