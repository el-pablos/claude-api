export type AccountStatus = "active" | "rate_limited" | "invalid" | "disabled";

export type PoolStrategy =
  | "round-robin"
  | "weighted"
  | "least-used"
  | "priority"
  | "random";

export interface ApiKeyAccount {
  id: string;
  name: string;
  apiKey: string;
  status: AccountStatus;
  usage: {
    total: number;
    success: number;
    failed: number;
  };
  rateLimit: {
    hit: number;
    resetAt: number | null;
  };
  metadata: {
    createdAt: number;
    lastUsedAt: number | null;
    priority: number;
    weight: number;
  };
  health: {
    consecutiveFailures: number;
    lastCheckAt: number | null;
  };
  inFlight: number;
}

export interface CreateAccountInput {
  name: string;
  apiKey: string;
  priority?: number;
  weight?: number;
}

export interface PoolMetrics {
  total: number;
  active: number;
  rateLimited: number;
  invalid: number;
  disabled: number;
  requests: {
    total: number;
    success: number;
    failed: number;
    perMinute: number;
    avgResponseTime: number;
  };
}

export interface PoolState {
  accounts: ApiKeyAccount[];
  currentIndex: number;
  lastSelectedId: string | null;
  config: {
    strategy: PoolStrategy;
  };
}

export interface RequestLogEntry {
  id: string;
  timestamp: number;
  accountId: string;
  accountName: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  attempts: number;
  error?: string;
}

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: string;
  apiSecretKey: string;
  encryptionKey: string;
  poolStrategy: PoolStrategy;
  poolStateFile: string;
  poolHealthCheckInterval: number;
  rateLimitCooldown: number;
  rateLimitMaxConsecutive: number;
  maxRetries: number;
  retryDelayBase: number;
  retryDelayMax: number;
  claudeBaseUrl: string;
  claudeApiTimeout: number;
  logLevel: string;
  dashboardEnabled: boolean;
  dashboardUsername: string;
  dashboardPassword: string;
}
