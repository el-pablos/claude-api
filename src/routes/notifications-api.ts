import { Hono } from "hono";
import {
  getNotifications,
  markRead,
  markAllRead,
  deleteNotification,
  clearAll,
} from "~/lib/notification-center";

export function createNotificationsApiRoutes(): Hono {
  const app = new Hono();

  app.get("/api/dashboard/notifications", (c) => {
    const result = getNotifications();
    return c.json({
      status: "ok",
      ...result,
    });
  });

  app.post("/api/dashboard/notifications/:id/read", (c) => {
    const id = c.req.param("id");
    const found = markRead(id);
    if (!found) {
      return c.json({ error: "Notification not found" }, 404);
    }
    return c.json({
      status: "ok",
      message: "Notification marked as read",
    });
  });

  app.post("/api/dashboard/notifications/read-all", (c) => {
    const count = markAllRead();
    return c.json({
      status: "ok",
      message: `${count} notifications marked as read`,
      count,
    });
  });

  app.delete("/api/dashboard/notifications/:id", (c) => {
    const id = c.req.param("id");
    const found = deleteNotification(id);
    if (!found) {
      return c.json({ error: "Notification not found" }, 404);
    }
    return c.json({
      status: "ok",
      message: "Notification deleted",
    });
  });

  app.delete("/api/dashboard/notifications", (c) => {
    const count = clearAll();
    return c.json({
      status: "ok",
      message: `${count} notifications cleared`,
      count,
    });
  });

  return app;
}
