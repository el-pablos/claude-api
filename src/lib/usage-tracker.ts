import { EventEmitter } from "node:events";

export interface UsageRecord {
  timestamp: number;
  accountId: string;
  accountName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface AccountUsageSummary {
  accountId: string;
  accountName: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
  byModel: Record<
    string,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cost: number;
    }
  >;
}

export interface HourlyUsage {
  hour: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface ModelUsageSummary {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  percentage: number;
}

export interface UsageOverview {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  byModel: ModelUsageSummary[];
  byAccount: AccountUsageSummary[];
  hourly: HourlyUsage[];
}

const MAX_RECORDS = 10000;

const records: UsageRecord[] = [];
const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function recordUsage(record: UsageRecord): void {
  records.unshift(record);
  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }
  emitter.emit("usage", record);
}

export function getUsageOverview(): UsageOverview {
  const modelMap = new Map<
    string,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cost: number;
    }
  >();
  const accountMap = new Map<string, AccountUsageSummary>();
  const hourMap = new Map<string, HourlyUsage>();

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalCost += r.cost;

    const existing = modelMap.get(r.model);
    if (existing) {
      existing.requests += 1;
      existing.inputTokens += r.inputTokens;
      existing.outputTokens += r.outputTokens;
      existing.cost += r.cost;
    } else {
      modelMap.set(r.model, {
        requests: 1,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cost: r.cost,
      });
    }

    const acctSummary = accountMap.get(r.accountId);
    if (acctSummary) {
      acctSummary.totalRequests += 1;
      acctSummary.totalInputTokens += r.inputTokens;
      acctSummary.totalOutputTokens += r.outputTokens;
      acctSummary.totalCacheReadTokens += r.cacheReadTokens;
      acctSummary.totalCacheWriteTokens += r.cacheWriteTokens;
      acctSummary.totalCost += r.cost;
      const modelEntry = acctSummary.byModel[r.model];
      if (modelEntry) {
        modelEntry.requests += 1;
        modelEntry.inputTokens += r.inputTokens;
        modelEntry.outputTokens += r.outputTokens;
        modelEntry.cost += r.cost;
      } else {
        acctSummary.byModel[r.model] = {
          requests: 1,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cost: r.cost,
        };
      }
    } else {
      accountMap.set(r.accountId, {
        accountId: r.accountId,
        accountName: r.accountName,
        totalRequests: 1,
        totalInputTokens: r.inputTokens,
        totalOutputTokens: r.outputTokens,
        totalCacheReadTokens: r.cacheReadTokens,
        totalCacheWriteTokens: r.cacheWriteTokens,
        totalCost: r.cost,
        byModel: {
          [r.model]: {
            requests: 1,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
            cost: r.cost,
          },
        },
      });
    }

    const hourKey = new Date(r.timestamp).toISOString().slice(0, 13);
    const hourEntry = hourMap.get(hourKey);
    if (hourEntry) {
      hourEntry.requests += 1;
      hourEntry.inputTokens += r.inputTokens;
      hourEntry.outputTokens += r.outputTokens;
      hourEntry.cost += r.cost;
    } else {
      hourMap.set(hourKey, {
        hour: hourKey,
        requests: 1,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        cost: r.cost,
      });
    }
  }

  const totalTokens = totalInput + totalOutput;
  const byModel: ModelUsageSummary[] = Array.from(modelMap.entries()).map(
    ([model, data]) => ({
      model,
      requests: data.requests,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.inputTokens + data.outputTokens,
      cost: Math.round(data.cost * 1_000_000) / 1_000_000,
      percentage:
        totalTokens > 0
          ? ((data.inputTokens + data.outputTokens) / totalTokens) * 100
          : 0,
    }),
  );

  byModel.sort((a, b) => b.totalTokens - a.totalTokens);

  const hourly = Array.from(hourMap.values()).sort((a, b) =>
    a.hour.localeCompare(b.hour),
  );

  return {
    totalRequests: records.length,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalTokens,
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    byModel,
    byAccount: Array.from(accountMap.values()),
    hourly: hourly.slice(-24),
  };
}

export function getAccountUsage(accountId: string): AccountUsageSummary | null {
  const overview = getUsageOverview();
  return overview.byAccount.find((a) => a.accountId === accountId) || null;
}

export function getUsageRecords(limit: number = 100): UsageRecord[] {
  return records.slice(0, limit);
}

export function clearUsage(): void {
  records.length = 0;
}

export function onUsageRecord(
  listener: (record: UsageRecord) => void,
): () => void {
  emitter.on("usage", listener);
  return () => {
    emitter.off("usage", listener);
  };
}
