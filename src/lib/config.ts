import type { AppConfig, PoolStrategy } from "./types";

const VALID_STRATEGIES: PoolStrategy[] = [
  "round-robin",
  "weighted",
  "least-used",
  "priority",
  "random",
];

export function loadConfig(): AppConfig {
  const strategy = (process.env.POOL_STRATEGY || "round-robin") as PoolStrategy;
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(
      `Invalid POOL_STRATEGY: ${strategy}. Valid: ${VALID_STRATEGIES.join(", ")}`,
    );
  }

  return {
    port: parseInt(process.env.PORT || "4143", 10),
    host: process.env.HOST || "0.0.0.0",
    nodeEnv: process.env.NODE_ENV || "development",
    apiSecretKey: process.env.API_SECRET_KEY || "",
    encryptionKey: process.env.ENCRYPTION_KEY || "",
    poolStrategy: strategy,
    poolStateFile: process.env.POOL_STATE_FILE || "./data/pool.json",
    poolHealthCheckInterval: parseInt(
      process.env.POOL_HEALTH_CHECK_INTERVAL || "60000",
      10,
    ),
    rateLimitCooldown: parseInt(process.env.RATE_LIMIT_COOLDOWN || "60000", 10),
    rateLimitMaxConsecutive: parseInt(
      process.env.RATE_LIMIT_MAX_CONSECUTIVE || "5",
      10,
    ),
    maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
    retryDelayBase: parseInt(process.env.RETRY_DELAY_BASE || "1000", 10),
    retryDelayMax: parseInt(process.env.RETRY_DELAY_MAX || "30000", 10),
    claudeBaseUrl: process.env.CLAUDE_BASE_URL || "https://api.anthropic.com",
    claudeApiTimeout: parseInt(process.env.CLAUDE_API_TIMEOUT || "300000", 10),
    logLevel: process.env.LOG_LEVEL || "info",
    dashboardEnabled: process.env.DASHBOARD_ENABLED !== "false",
    dashboardUsername: process.env.DASHBOARD_USERNAME || "admin",
    dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  };
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
