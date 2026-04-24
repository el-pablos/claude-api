import { Hono } from "hono";
import type { ProxyHandler } from "~/lib/proxy";

type AppEnv = {
  Variables: {
    requestId: string;
  };
};

export function createApiRoutes(proxy: ProxyHandler): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/v1/messages", async (c) => {
    const body = await c.req.arrayBuffer();
    const result = await proxy.handleRequest(
      "POST",
      "/v1/messages",
      c.req.raw.headers,
      body,
      c.get("requestId"),
    );

    const headers = new Headers();
    result.response.headers.forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("x-proxy-account", result.accountId);
    headers.set("x-proxy-attempts", String(result.attempts));

    return new Response(result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    });
  });

  app.get("/v1/models", async (c) => {
    const result = await proxy.handleRequest(
      "GET",
      "/v1/models",
      c.req.raw.headers,
      null,
      c.get("requestId"),
    );

    const headers = new Headers();
    result.response.headers.forEach((value, key) => {
      headers.set(key, value);
    });

    return new Response(result.response.body, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers,
    });
  });

  return app;
}
