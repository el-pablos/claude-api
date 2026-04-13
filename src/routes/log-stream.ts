import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { onLog } from "~/lib/logger";
import type { LogEntry } from "~/lib/logger";

export function createLogStreamRoutes(): Hono {
  const app = new Hono();

  app.get("/api/dashboard/logs/stream", (c) => {
    return streamSSE(c, async (stream) => {
      let alive = true;

      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          message: "Log stream connected",
          timestamp: Date.now(),
        }),
      });

      const removeListener = onLog((entry: LogEntry) => {
        if (!alive) return;
        stream
          .writeSSE({
            event: "log",
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
