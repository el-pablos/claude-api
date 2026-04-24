import { Hono } from "hono";
import {
  getUsageOverview,
  getAccountUsage,
  getUsageRecords,
} from "~/lib/usage-tracker";
import {
  getDailyCostHistory,
  getTodayCost,
  getAllPricing,
} from "~/lib/cost-calculator";

export function createUsageApiRoutes(): Hono {
  const app = new Hono();

  app.get("/api/dashboard/usage", (c) => {
    const overview = getUsageOverview();
    return c.json({ status: "ok", ...overview });
  });

  app.get("/api/dashboard/usage/accounts/:id", (c) => {
    const id = c.req.param("id");
    const usage = getAccountUsage(id);
    if (!usage) {
      return c.json({ status: "ok", usage: null });
    }
    return c.json({ status: "ok", usage });
  });

  app.get("/api/dashboard/usage/records", (c) => {
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const records = getUsageRecords(limit);
    return c.json({ status: "ok", records });
  });

  app.get("/api/dashboard/cost", (c) => {
    const overview = getUsageOverview();
    const todayCost = getTodayCost();
    const dailyHistory = getDailyCostHistory(30);
    const pricing = getAllPricing();

    const costByModel: Record<string, number> = {};
    for (const m of overview.byModel) {
      costByModel[m.model] = m.cost;
    }

    const costByAccount: Record<string, { name: string; cost: number }> = {};
    for (const a of overview.byAccount) {
      costByAccount[a.accountId] = {
        name: a.accountName,
        cost: Math.round(a.totalCost * 1_000_000) / 1_000_000,
      };
    }

    const avgDailyCost =
      dailyHistory.length > 0
        ? dailyHistory.reduce((s, d) => s + d.totalCost, 0) /
          dailyHistory.length
        : 0;

    return c.json({
      status: "ok",
      totalCost: overview.totalCost,
      todayCost: Math.round(todayCost * 1_000_000) / 1_000_000,
      avgDailyCost: Math.round(avgDailyCost * 1_000_000) / 1_000_000,
      costByModel,
      costByAccount,
      dailyHistory,
      pricing,
    });
  });

  app.get("/api/dashboard/cost/pricing", (c) => {
    return c.json({ status: "ok", pricing: getAllPricing() });
  });

  return app;
}
