export type AccountStatus = "active" | "rate_limited" | "invalid" | "disabled";

export type PoolStrategy =
  | "round-robin"
  | "weighted"
  | "least-used"
  | "priority"
  | "random";

export interface OAuthTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface ApiKeyAccount {
  id: string;
  name: string;
  oauth: OAuthTokenData;
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
  oauthCode: string;
  state?: string;
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

export interface HistoryEntry {
  id: string;
  timestamp: number;
  model: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  accountId: string;
  accountName: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
  cached: boolean;
}

export type NotificationType = "error" | "warning" | "info" | "success";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
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
