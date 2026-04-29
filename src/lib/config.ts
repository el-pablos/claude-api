import type { AppConfig, PoolStrategy } from "./types";

const VALID_STRATEGIES: PoolStrategy[] = [
  "round-robin",
  "weighted",
  "least-used",
  "priority",
  "random",
];

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"];
const MIN_ENCRYPTION_KEY_LENGTH = 32;

function parseIntInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!raw || raw.trim().length === 0) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a valid integer`);
  }
  if (n < min || n > max) {
    throw new Error(
      `Invalid ${name}: ${n} di luar range [${min}, ${max}]`,
    );
  }
  return n;
}

export function loadConfig(): AppConfig {
  const strategy = (process.env.POOL_STRATEGY || "round-robin") as PoolStrategy;
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(
      `Invalid POOL_STRATEGY: ${strategy}. Valid: ${VALID_STRATEGIES.join(", ")}`,
    );
  }

  const logLevel = process.env.LOG_LEVEL || "info";
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL: ${logLevel}. Valid: ${VALID_LOG_LEVELS.join(", ")}`,
    );
  }

  const nodeEnv = process.env.NODE_ENV || "development";
  const encryptionKey = process.env.ENCRYPTION_KEY || "";

  if (
    nodeEnv === "production" &&
    encryptionKey.length > 0 &&
    encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH
  ) {
    throw new Error(
      `ENCRYPTION_KEY harus minimal ${MIN_ENCRYPTION_KEY_LENGTH} karakter di production. Saat ini ${encryptionKey.length}.`,
    );
  }

  return {
    port: parseIntInRange(process.env.PORT, 4143, 1, 65535, "PORT"),
    host: process.env.HOST || "0.0.0.0",
    nodeEnv,
    apiSecretKey: process.env.API_SECRET_KEY || "",
    encryptionKey,
    poolStrategy: strategy,
    poolStateFile: process.env.POOL_STATE_FILE || "./data/pool.json",
    poolHealthCheckInterval: parseIntInRange(
      process.env.POOL_HEALTH_CHECK_INTERVAL,
      60000,
      1000,
      24 * 60 * 60 * 1000,
      "POOL_HEALTH_CHECK_INTERVAL",
    ),
    rateLimitCooldown: parseIntInRange(
      process.env.RATE_LIMIT_COOLDOWN,
      60000,
      0,
      24 * 60 * 60 * 1000,
      "RATE_LIMIT_COOLDOWN",
    ),
    rateLimitMaxConsecutive: parseIntInRange(
      process.env.RATE_LIMIT_MAX_CONSECUTIVE,
      5,
      1,
      1000,
      "RATE_LIMIT_MAX_CONSECUTIVE",
    ),
    maxRetries: parseIntInRange(process.env.MAX_RETRIES, 3, 0, 100, "MAX_RETRIES"),
    retryDelayBase: parseIntInRange(
      process.env.RETRY_DELAY_BASE,
      1000,
      0,
      60000,
      "RETRY_DELAY_BASE",
    ),
    retryDelayMax: parseIntInRange(
      process.env.RETRY_DELAY_MAX,
      30000,
      0,
      10 * 60 * 1000,
      "RETRY_DELAY_MAX",
    ),
    claudeBaseUrl: process.env.CLAUDE_BASE_URL || "https://api.anthropic.com",
    claudeApiTimeout: parseIntInRange(
      process.env.CLAUDE_API_TIMEOUT,
      300000,
      1000,
      30 * 60 * 1000,
      "CLAUDE_API_TIMEOUT",
    ),
    logLevel,
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
