import type { AccountManager } from "./account-manager";
import type { AppConfig, RequestLogEntry } from "./types";
import { logger } from "./logger";
import { recordRequest } from "./metrics";
import { isRateLimitError, isAuthError, parseRetryAfter } from "./retry";
import { randomUUID } from "node:crypto";

export interface ProxyResult {
  response: Response;
  accountId: string;
  attempts: number;
}

const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "x-api-key",
  "authorization",
  "content-length",
]);

const STRIP_RESPONSE_HEADERS = new Set(["transfer-encoding", "connection"]);

export class ProxyHandler {
  private manager: AccountManager;
  private config: AppConfig;

  constructor(manager: AccountManager, config: AppConfig) {
    this.manager = manager;
    this.config = config;
  }

  async handleRequest(
    method: string,
    path: string,
    headers: Headers,
    body: ReadableStream<Uint8Array> | ArrayBuffer | null,
    requestId?: string,
  ): Promise<ProxyResult> {
    const rid = requestId || randomUUID();
    const startTime = Date.now();
    let attempts = 0;
    let lastAccountId = "";
    const triedAccountIds = new Set<string>();

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      attempts = attempt;

      const account = this.manager.getNextAccount();
      if (!account) {
        const err = new Error("No available accounts in pool");
        (err as Error & { status: number }).status = 503;
        this.logRequest(
          rid,
          lastAccountId,
          "",
          method,
          path,
          503,
          Date.now() - startTime,
          attempts,
          err.message,
        );
        throw err;
      }

      if (
        triedAccountIds.has(account.id) &&
        triedAccountIds.size >= this.getActiveCount()
      ) {
        const err = new Error("All accounts exhausted");
        (err as Error & { status: number }).status = 503;
        this.logRequest(
          rid,
          account.id,
          account.name,
          method,
          path,
          503,
          Date.now() - startTime,
          attempts,
          err.message,
        );
        throw err;
      }

      triedAccountIds.add(account.id);
      lastAccountId = account.id;

      const decryptedKey = this.manager.getDecryptedKey(account);
      this.manager.incrementInFlight(account.id);

      try {
        const targetUrl = `${this.config.claudeBaseUrl}${path}`;
        const proxyHeaders = this.buildRequestHeaders(headers, decryptedKey);

        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.claudeApiTimeout,
        );

        let fetchBody: BodyInit | null = null;
        if (body instanceof ReadableStream) {
          const reader = body.getReader();
          const chunks: Uint8Array[] = [];
          let done = false;
          while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) chunks.push(result.value);
          }
          const totalLength = chunks.reduce((s, c) => s + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          fetchBody = merged;
        } else if (body instanceof ArrayBuffer) {
          fetchBody = body;
        }

        const response = await fetch(targetUrl, {
          method,
          headers: proxyHeaders,
          body: fetchBody,
          signal: controller.signal,
          // @ts-expect-error duplex needed for streaming request bodies
          duplex: "half",
        });

        clearTimeout(timeout);

        if (isRateLimitError(response.status)) {
          this.manager.decrementInFlight(account.id);
          const resetAt = parseRetryAfter(response.headers);
          this.manager.markRateLimited(account.id, resetAt ?? undefined);
          logger.warn("Rate limit hit, rotating account", {
            requestId: rid,
            accountId: account.id,
            name: account.name,
            attempt,
          });
          continue;
        }

        if (isAuthError(response.status)) {
          this.manager.decrementInFlight(account.id);
          this.manager.markInvalid(account.id);
          logger.error("Auth error, marking account invalid", {
            requestId: rid,
            accountId: account.id,
            name: account.name,
            status: response.status,
          });
          continue;
        }

        if (response.status >= 500 && attempt <= this.config.maxRetries) {
          this.manager.decrementInFlight(account.id);
          this.manager.markFailed(
            account.id,
            new Error(`Server error: ${response.status}`),
          );
          logger.warn("Server error, retrying", {
            requestId: rid,
            accountId: account.id,
            status: response.status,
            attempt,
          });
          continue;
        }

        const responseTime = Date.now() - startTime;
        if (response.ok) {
          this.manager.markSuccess(account.id);
        } else {
          this.manager.markFailed(
            account.id,
            new Error(`HTTP ${response.status}`),
          );
        }

        this.logRequest(
          rid,
          account.id,
          account.name,
          method,
          path,
          response.status,
          responseTime,
          attempts,
        );

        const proxyResponse = this.buildResponse(response);

        this.manager.decrementInFlight(account.id);

        return {
          response: proxyResponse,
          accountId: account.id,
          attempts,
        };
      } catch (err) {
        this.manager.decrementInFlight(account.id);
        const error = err as Error & { status?: number };

        if (error.name === "AbortError") {
          this.manager.markFailed(account.id, new Error("Request timeout"));
          logger.error("Request timeout", {
            requestId: rid,
            accountId: account.id,
            timeout: this.config.claudeApiTimeout,
          });
        } else {
          this.manager.markFailed(account.id, error);
          logger.error("Proxy request failed", {
            requestId: rid,
            accountId: account.id,
            error: error.message,
            attempt,
          });
        }

        if (attempt > this.config.maxRetries) {
          this.logRequest(
            rid,
            account.id,
            account.name,
            method,
            path,
            error.status || 502,
            Date.now() - startTime,
            attempts,
            error.message,
          );
          throw error;
        }
      }
    }

    const finalErr = new Error("All retry attempts exhausted");
    (finalErr as Error & { status: number }).status = 503;
    this.logRequest(
      rid,
      lastAccountId,
      "",
      "POST",
      path,
      503,
      Date.now() - startTime,
      attempts,
      finalErr.message,
    );
    throw finalErr;
  }

  private buildRequestHeaders(
    original: Headers,
    apiKey: string,
  ): Record<string, string> {
    const result: Record<string, string> = {};

    original.forEach((value, key) => {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
        result[key] = value;
      }
    });

    result["x-api-key"] = apiKey;
    result["anthropic-version"] = result["anthropic-version"] || "2023-06-01";

    if (!result["content-type"]) {
      result["content-type"] = "application/json";
    }

    return result;
  }

  private buildResponse(upstream: Response): Response {
    const headers = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    headers.set("x-proxy", "claude-api");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  private getActiveCount(): number {
    return this.manager.getAllAccounts().filter((a) => a.status === "active")
      .length;
  }

  private logRequest(
    requestId: string,
    accountId: string,
    accountName: string,
    method: string,
    path: string,
    statusCode: number,
    responseTime: number,
    attempts: number,
    error?: string,
  ): void {
    const entry: RequestLogEntry = {
      id: requestId,
      timestamp: Date.now(),
      accountId,
      accountName,
      method,
      path,
      statusCode,
      responseTime,
      attempts,
      error,
    };
    recordRequest(entry);

    logger.info("Request completed", {
      requestId,
      accountId,
      method,
      path,
      statusCode,
      responseTime,
      attempts,
    });
  }
}
