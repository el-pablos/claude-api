import type { ApiKeyAccount, PoolStrategy } from "./types";

export interface StrategyContext {
  accounts: ApiKeyAccount[];
  currentIndex: number;
}

export interface StrategyResult {
  account: ApiKeyAccount | null;
  nextIndex: number;
}

function getActiveAccounts(accounts: ApiKeyAccount[]): ApiKeyAccount[] {
  return accounts.filter((a) => a.status === "active");
}

export function selectByRoundRobin(ctx: StrategyContext): StrategyResult {
  const active = getActiveAccounts(ctx.accounts);
  if (active.length === 0)
    return { account: null, nextIndex: ctx.currentIndex };

  const idx = ctx.currentIndex % active.length;
  return {
    account: active[idx],
    nextIndex: ctx.currentIndex + 1,
  };
}

export function selectByWeightedRoundRobin(
  ctx: StrategyContext,
): StrategyResult {
  const active = getActiveAccounts(ctx.accounts);
  if (active.length === 0)
    return { account: null, nextIndex: ctx.currentIndex };

  const totalWeight = active.reduce((sum, a) => sum + a.metadata.weight, 0);
  if (totalWeight === 0) return { account: null, nextIndex: ctx.currentIndex };

  const position = ctx.currentIndex % totalWeight;
  let cumulative = 0;
  for (const account of active) {
    cumulative += account.metadata.weight;
    if (position < cumulative) {
      return {
        account,
        nextIndex: ctx.currentIndex + 1,
      };
    }
  }

  return {
    account: active[active.length - 1],
    nextIndex: ctx.currentIndex + 1,
  };
}

export function selectByLeastUsed(ctx: StrategyContext): StrategyResult {
  const active = getActiveAccounts(ctx.accounts);
  if (active.length === 0)
    return { account: null, nextIndex: ctx.currentIndex };

  let best = active[0];
  for (let i = 1; i < active.length; i++) {
    if (active[i].inFlight < best.inFlight) {
      best = active[i];
    } else if (active[i].inFlight === best.inFlight) {
      if (active[i].usage.total < best.usage.total) {
        best = active[i];
      }
    }
  }

  return { account: best, nextIndex: ctx.currentIndex };
}

export function selectByPriority(ctx: StrategyContext): StrategyResult {
  const active = getActiveAccounts(ctx.accounts);
  if (active.length === 0)
    return { account: null, nextIndex: ctx.currentIndex };

  const sorted = [...active].sort(
    (a, b) => b.metadata.priority - a.metadata.priority,
  );
  return { account: sorted[0], nextIndex: ctx.currentIndex };
}

export function selectByRandom(ctx: StrategyContext): StrategyResult {
  const active = getActiveAccounts(ctx.accounts);
  if (active.length === 0)
    return { account: null, nextIndex: ctx.currentIndex };

  const idx = Math.floor(Math.random() * active.length);
  return { account: active[idx], nextIndex: ctx.currentIndex };
}

const strategies: Record<
  PoolStrategy,
  (ctx: StrategyContext) => StrategyResult
> = {
  "round-robin": selectByRoundRobin,
  weighted: selectByWeightedRoundRobin,
  "least-used": selectByLeastUsed,
  priority: selectByPriority,
  random: selectByRandom,
};

export function selectAccount(
  strategy: PoolStrategy,
  ctx: StrategyContext,
): StrategyResult {
  const fn = strategies[strategy];
  if (!fn) {
    throw new Error(`Unknown pool strategy: ${strategy}`);
  }
  return fn(ctx);
}
