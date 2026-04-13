import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";

export function createDashboardRoutes(): Hono {
  const app = new Hono();

  app.get("/dashboard", (c) => {
    const htmlPath = path.resolve(
      import.meta.dirname || __dirname,
      "../dashboard/index.html",
    );
    const html = fs.readFileSync(htmlPath, "utf-8");
    return c.html(html);
  });

  return app;
}
