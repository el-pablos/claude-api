export interface ModelPricing {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export interface DailyCostEntry {
  date: string;
  totalCost: number;
  requests: number;
  byModel: Record<string, number>;
}

export interface CostSummary {
  totalCost: number;
  todayCost: number;
  avgDailyCost: number;
  costByModel: Record<string, number>;
  costByAccount: Record<string, { name: string; cost: number }>;
  dailyHistory: DailyCostEntry[];
  pricing: ModelPricing[];
}

const MODEL_PRICING: ModelPricing[] = [
  {
    model: "claude-sonnet-4-20250514",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    model: "claude-opus-4-20250514",
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    model: "claude-haiku-3-5-20241022",
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1.0,
  },
  {
    model: "claude-3-5-sonnet-20241022",
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  {
    model: "claude-3-opus-20240229",
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  {
    model: "claude-3-haiku-20240307",
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
    cacheReadPerMillion: 0.03,
    cacheWritePerMillion: 0.3,
  },
];

const DEFAULT_PRICING: ModelPricing = {
  model: "unknown",
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
  cacheReadPerMillion: 0.3,
  cacheWritePerMillion: 3.75,
};

export function getPricing(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  const found = MODEL_PRICING.find((p) =>
    normalized.includes(p.model.toLowerCase().replace(/-\d{8}$/, "")),
  );
  if (found) return found;

  if (normalized.includes("opus"))
    return MODEL_PRICING.find((p) => p.model.includes("opus-4"))!;
  if (normalized.includes("haiku"))
    return MODEL_PRICING.find((p) => p.model.includes("haiku-3-5"))!;
  if (normalized.includes("sonnet"))
    return MODEL_PRICING.find((p) => p.model.includes("sonnet-4"))!;

  return { ...DEFAULT_PRICING, model };
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheWriteTokens: number = 0,
): CostBreakdown {
  const pricing = getPricing(model);

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost =
    (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  const cacheWriteCost =
    (cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;

  return {
    inputCost: round6(inputCost),
    outputCost: round6(outputCost),
    cacheReadCost: round6(cacheReadCost),
    cacheWriteCost: round6(cacheWriteCost),
    totalCost: round6(inputCost + outputCost + cacheReadCost + cacheWriteCost),
  };
}

export function getAllPricing(): ModelPricing[] {
  return [...MODEL_PRICING];
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

const dailyCosts = new Map<string, DailyCostEntry>();

export function recordDailyCost(
  date: string,
  model: string,
  cost: number,
): void {
  const entry = dailyCosts.get(date);
  if (entry) {
    entry.totalCost += cost;
    entry.requests += 1;
    entry.byModel[model] = (entry.byModel[model] || 0) + cost;
  } else {
    dailyCosts.set(date, {
      date,
      totalCost: cost,
      requests: 1,
      byModel: { [model]: cost },
    });
  }
}

export function getDailyCostHistory(days: number = 30): DailyCostEntry[] {
  return Array.from(dailyCosts.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);
}

export function getTodayCost(): number {
  const today = new Date().toISOString().slice(0, 10);
  return dailyCosts.get(today)?.totalCost || 0;
}

export function clearDailyCosts(): void {
  dailyCosts.clear();
}
