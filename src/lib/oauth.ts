import { randomBytes, createHash } from "node:crypto";
import { logger } from "./logger";

const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize";
const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
const CLAUDE_SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
].join(" ");

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface ParsedAuthorizationCode {
  code: string;
  state?: string;
}

export interface PendingAuth {
  challenge: PKCEChallenge;
  authorizeUrl: string;
  createdAt: number;
  accountName: string;
}

const pendingAuths = new Map<string, PendingAuth>();
const PENDING_AUTH_TTL = 10 * 60 * 1000;

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return randomBytes(32).toString("base64url");
}

export function createPKCEChallenge(): PKCEChallenge {
  const codeVerifier = generateCodeVerifier();
  return {
    codeVerifier,
    codeChallenge: generateCodeChallenge(codeVerifier),
    state: generateState(),
  };
}

export function buildAuthorizeUrl(challenge: PKCEChallenge): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: CLAUDE_SCOPES,
    code_challenge: challenge.codeChallenge,
    code_challenge_method: "S256",
    state: challenge.state,
  });
  return `${CLAUDE_AUTHORIZE_URL}?${params.toString()}`;
}

function splitCodeAndState(
  codeValue: string,
  fallbackState?: string,
): ParsedAuthorizationCode {
  const hashIndex = codeValue.indexOf("#");
  const code = hashIndex >= 0 ? codeValue.slice(0, hashIndex) : codeValue;
  const state =
    hashIndex >= 0
      ? codeValue.slice(hashIndex + 1) || fallbackState
      : fallbackState;

  if (!code) {
    throw new Error("OAuth authorization code is required");
  }

  return state ? { code, state } : { code };
}

export function parseAuthorizationCode(input: string): ParsedAuthorizationCode {
  let value = input.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!value) {
    throw new Error("OAuth authorization code is required");
  }

  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    if (code) {
      return splitCodeAndState(code, url.searchParams.get("state") ?? undefined);
    }
  } catch {
    // Not a URL; continue with pasted code formats below.
  }

  value = value.replace(/^code\s*[:=]\s*/i, "").replace(/\s+/g, "");
  return splitCodeAndState(value);
}

export function startAuth(accountName: string): PendingAuth {
  cleanExpiredAuths();
  const challenge = createPKCEChallenge();
  const authorizeUrl = buildAuthorizeUrl(challenge);
  const pending: PendingAuth = {
    challenge,
    authorizeUrl,
    createdAt: Date.now(),
    accountName,
  };
  pendingAuths.set(challenge.state, pending);
  logger.info("OAuth auth started", {
    state: challenge.state,
    accountName,
  });
  return pending;
}

export function getPendingAuth(state: string): PendingAuth | null {
  const pending = pendingAuths.get(state);
  if (!pending) return null;
  if (Date.now() - pending.createdAt > PENDING_AUTH_TTL) {
    pendingAuths.delete(state);
    return null;
  }
  return pending;
}

export function getLatestPendingAuth(): PendingAuth | null {
  cleanExpiredAuths();
  let latest: PendingAuth | null = null;
  for (const pending of pendingAuths.values()) {
    if (!latest || pending.createdAt > latest.createdAt) {
      latest = pending;
    }
  }
  return latest;
}

export function removePendingAuth(state: string): void {
  pendingAuths.delete(state);
}

export function getPendingAuthCount(): number {
  cleanExpiredAuths();
  return pendingAuths.size;
}

function cleanExpiredAuths(): void {
  const now = Date.now();
  for (const [state, pending] of pendingAuths) {
    if (now - pending.createdAt > PENDING_AUTH_TTL) {
      pendingAuths.delete(state);
    }
  }
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  state?: string,
): Promise<OAuthTokens> {
  logger.info("Exchanging OAuth code for tokens");

  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    client_id: CLAUDE_CLIENT_ID,
    code_verifier: codeVerifier,
    redirect_uri: CLAUDE_REDIRECT_URI,
  };
  if (state) body.state = state;

  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "anthropic",
      "anthropic-beta": CLAUDE_OAUTH_BETA,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    logger.error("Token exchange failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!data.access_token) {
    throw new Error("Token exchange response missing access_token");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  logger.info("Refreshing OAuth access token");

  const response = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "anthropic",
      "anthropic-beta": CLAUDE_OAUTH_BETA,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    logger.error("Token refresh failed", {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

export function isTokenExpiringSoon(
  expiresAt: number,
  bufferMs: number = 60_000,
): boolean {
  return Date.now() >= expiresAt - bufferMs;
}

export function getClientId(): string {
  return CLAUDE_CLIENT_ID;
}

export function getScopes(): string {
  return CLAUDE_SCOPES;
}
