import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  ApiKeyAccount,
  AppConfig,
  CreateAccountInput,
  PoolMetrics,
  PoolState,
} from "./types";
import { encrypt, decrypt, maskApiKey } from "./crypto";
import { logger } from "./logger";
import { getRequestsPerMinute, getAvgResponseTime } from "./metrics";
import { selectAccount } from "./pool-strategy";
import {
  loadState,
  saveState,
  saveStateImmediate,
  createEmptyState,
} from "./storage";

export class AccountManager extends EventEmitter {
  private state: PoolState;
  private config: AppConfig;
  private recoveryInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private persistInterval: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.state = createEmptyState();
    this.state.config.strategy = config.poolStrategy;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const loaded = await loadState(this.config.poolStateFile);
    this.state = {
      ...loaded,
      config: {
        strategy: this.config.poolStrategy,
      },
    };

    this.startRateLimitRecoveryJob();
    this.startHealthCheckJob();
    this.startStatePersistenceJob();

    this.initialized = true;
    logger.info("AccountManager initialized", {
      accounts: this.state.accounts.length,
      strategy: this.state.config.strategy,
    });
    this.emit("initialized");
  }

  async shutdown(): Promise<void> {
    if (this.recoveryInterval) clearInterval(this.recoveryInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.persistInterval) clearInterval(this.persistInterval);
    this.recoveryInterval = null;
    this.healthCheckInterval = null;
    this.persistInterval = null;
    await saveStateImmediate(this.config.poolStateFile, this.state);
    logger.info("AccountManager shut down");
  }

  async addAccount(input: CreateAccountInput): Promise<ApiKeyAccount> {
    if (!input.apiKey || input.apiKey.trim().length === 0) {
      throw new Error("API key is required");
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new Error("Account name is required");
    }

    const existing = this.state.accounts.find(
      (a) => this.decryptKey(a.apiKey) === input.apiKey,
    );
    if (existing) {
      throw new Error(`API key already exists in pool as "${existing.name}"`);
    }

    const encryptedKey = this.config.encryptionKey
      ? encrypt(input.apiKey, this.config.encryptionKey)
      : input.apiKey;

    const account: ApiKeyAccount = {
      id: randomUUID(),
      name: input.name.trim(),
      apiKey: encryptedKey,
      status: "active",
      usage: { total: 0, success: 0, failed: 0 },
      rateLimit: { hit: 0, resetAt: null },
      metadata: {
        createdAt: Date.now(),
        lastUsedAt: null,
        priority: input.priority ?? 50,
        weight: input.weight ?? 1,
      },
      health: { consecutiveFailures: 0, lastCheckAt: null },
      inFlight: 0,
    };

    this.state.accounts.push(account);
    this.persist();

    logger.info("Account added to pool", {
      accountId: account.id,
      name: account.name,
    });
    this.emit("account:added", account);
    return this.sanitizeAccount(account);
  }

  async removeAccount(accountId: string): Promise<void> {
    const idx = this.state.accounts.findIndex((a) => a.id === accountId);
    if (idx === -1) {
      throw new Error(`Account not found: ${accountId}`);
    }
    const removed = this.state.accounts.splice(idx, 1)[0];
    this.persist();
    logger.info("Account removed from pool", {
      accountId: removed.id,
      name: removed.name,
    });
    this.emit("account:removed", removed);
  }

  async updateAccount(
    accountId: string,
    updates: { name?: string; priority?: number; weight?: number },
  ): Promise<ApiKeyAccount> {
    const account = this.findAccount(accountId);
    if (updates.name !== undefined) account.name = updates.name.trim();
    if (updates.priority !== undefined)
      account.metadata.priority = updates.priority;
    if (updates.weight !== undefined) account.metadata.weight = updates.weight;
    account.metadata.lastUsedAt = account.metadata.lastUsedAt;
    this.persist();
    logger.info("Account updated", { accountId, updates });
    this.emit("account:updated", account);
    return this.sanitizeAccount(account);
  }

  getNextAccount(): ApiKeyAccount | null {
    const result = selectAccount(this.state.config.strategy, {
      accounts: this.state.accounts,
      currentIndex: this.state.currentIndex,
    });

    this.state.currentIndex = result.nextIndex;
    if (result.account) {
      this.state.lastSelectedId = result.account.id;
    }
    return result.account;
  }

  getDecryptedKey(account: ApiKeyAccount): string {
    return this.decryptKey(account.apiKey);
  }

  markRateLimited(accountId: string, resetAt?: number): void {
    const account = this.findAccount(accountId);
    account.status = "rate_limited";
    account.rateLimit.hit += 1;
    account.rateLimit.resetAt =
      resetAt ?? Date.now() + this.config.rateLimitCooldown;
    this.persist();
    logger.warn("Account rate limited", {
      accountId,
      name: account.name,
      resetAt: account.rateLimit.resetAt,
    });
    this.emit("account:rate-limited", account);
  }

  markInvalid(accountId: string): void {
    const account = this.findAccount(accountId);
    account.status = "invalid";
    this.persist();
    logger.error("Account marked invalid", {
      accountId,
      name: account.name,
    });
    this.emit("account:invalid", account);
  }

  markSuccess(accountId: string): void {
    const account = this.findAccount(accountId);
    account.usage.total += 1;
    account.usage.success += 1;
    account.metadata.lastUsedAt = Date.now();
    account.health.consecutiveFailures = 0;
    this.persist();
  }

  markFailed(accountId: string, error: Error): void {
    const account = this.findAccount(accountId);
    account.usage.total += 1;
    account.usage.failed += 1;
    account.metadata.lastUsedAt = Date.now();
    account.health.consecutiveFailures += 1;

    if (
      account.health.consecutiveFailures >= this.config.rateLimitMaxConsecutive
    ) {
      account.status = "invalid";
      logger.error("Account auto-invalidated due to consecutive failures", {
        accountId,
        name: account.name,
        failures: account.health.consecutiveFailures,
      });
      this.emit("account:invalid", account);
    }

    this.persist();
  }

  incrementInFlight(accountId: string): void {
    const account = this.findAccount(accountId);
    account.inFlight += 1;
  }

  decrementInFlight(accountId: string): void {
    const account = this.state.accounts.find((a) => a.id === accountId);
    if (account && account.inFlight > 0) {
      account.inFlight -= 1;
    }
  }

  getAllAccounts(): ApiKeyAccount[] {
    return this.state.accounts.map((a) => this.sanitizeAccount(a));
  }

  getAccount(accountId: string): ApiKeyAccount | null {
    const account = this.state.accounts.find((a) => a.id === accountId);
    if (!account) return null;
    return this.sanitizeAccount(account);
  }

  getPoolMetrics(): PoolMetrics {
    const accounts = this.state.accounts;
    const totalRequests = accounts.reduce((s, a) => s + a.usage.total, 0);
    const totalSuccess = accounts.reduce((s, a) => s + a.usage.success, 0);
    const totalFailed = accounts.reduce((s, a) => s + a.usage.failed, 0);

    return {
      total: accounts.length,
      active: accounts.filter((a) => a.status === "active").length,
      rateLimited: accounts.filter((a) => a.status === "rate_limited").length,
      invalid: accounts.filter((a) => a.status === "invalid").length,
      disabled: accounts.filter((a) => a.status === "disabled").length,
      requests: {
        total: totalRequests,
        success: totalSuccess,
        failed: totalFailed,
        perMinute: getRequestsPerMinute(),
        avgResponseTime: getAvgResponseTime(),
      },
    };
  }

  hasAvailableAccounts(): boolean {
    return this.state.accounts.some((a) => a.status === "active");
  }

  async resetRateLimit(accountId: string): Promise<void> {
    const account = this.findAccount(accountId);
    account.status = "active";
    account.rateLimit.resetAt = null;
    this.persist();
    logger.info("Rate limit reset for account", {
      accountId,
      name: account.name,
    });
    this.emit("account:recovered", account);
  }

  async disableAccount(accountId: string): Promise<void> {
    const account = this.findAccount(accountId);
    account.status = "disabled";
    this.persist();
    logger.info("Account disabled", { accountId, name: account.name });
    this.emit("account:disabled", account);
  }

  async enableAccount(accountId: string): Promise<void> {
    const account = this.findAccount(accountId);
    account.status = "active";
    account.health.consecutiveFailures = 0;
    this.persist();
    logger.info("Account enabled", { accountId, name: account.name });
    this.emit("account:enabled", account);
  }

  getStrategy() {
    return this.state.config.strategy;
  }

  setStrategy(strategy: string): void {
    this.state.config.strategy = strategy as PoolState["config"]["strategy"];
    this.persist();
  }

  getState(): PoolState {
    return this.state;
  }

  private findAccount(accountId: string): ApiKeyAccount {
    const account = this.state.accounts.find((a) => a.id === accountId);
    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }
    return account;
  }

  private decryptKey(storedKey: string): string {
    if (!this.config.encryptionKey) return storedKey;
    if (!storedKey.includes(":")) return storedKey;
    try {
      return decrypt(storedKey, this.config.encryptionKey);
    } catch {
      return storedKey;
    }
  }

  private sanitizeAccount(account: ApiKeyAccount): ApiKeyAccount {
    return {
      ...account,
      apiKey: maskApiKey(this.decryptKey(account.apiKey)),
    };
  }

  private persist(): void {
    saveState(this.config.poolStateFile, this.state);
  }

  private startRateLimitRecoveryJob(): void {
    this.recoveryInterval = setInterval(() => {
      const now = Date.now();
      for (const account of this.state.accounts) {
        if (
          account.status === "rate_limited" &&
          account.rateLimit.resetAt &&
          now >= account.rateLimit.resetAt
        ) {
          account.status = "active";
          account.rateLimit.resetAt = null;
          logger.info("Account auto-recovered from rate limit", {
            accountId: account.id,
            name: account.name,
          });
          this.emit("account:recovered", account);
        }
      }
      this.persist();
    }, 5000);
  }

  private startHealthCheckJob(): void {
    this.healthCheckInterval = setInterval(() => {
      for (const account of this.state.accounts) {
        if (account.status === "active") {
          account.health.lastCheckAt = Date.now();
        }
      }
    }, this.config.poolHealthCheckInterval);
  }

  private startStatePersistenceJob(): void {
    this.persistInterval = setInterval(() => {
      this.persist();
    }, 10000);
  }
}
