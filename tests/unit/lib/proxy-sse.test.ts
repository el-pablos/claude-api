import { describe, it, expect, beforeEach } from "vitest";
import { ProxyHandler } from "~/lib/proxy";
import { AccountManager } from "~/lib/account-manager";
import type { AppConfig } from "~/lib/types";
import { clearUsage, getUsageOverview } from "~/lib/usage-tracker";
import { clearHistory, getHistory } from "~/lib/request-history";

function makeConfig(): AppConfig {
  return {
    port: 4143,
    host: "127.0.0.1",
    nodeEnv: "test",
    apiSecretKey: "",
    encryptionKey: "test-encryption-key-32-chars-ok!",
    poolStrategy: "round-robin",
    poolStateFile: ":memory:",
    poolHealthCheckInterval: 60000,
    rateLimitCooldown: 60000,
    rateLimitMaxConsecutive: 5,
    maxRetries: 3,
    retryDelayBase: 1000,
    retryDelayMax: 30000,
    claudeBaseUrl: "https://api.anthropic.com",
    claudeApiTimeout: 300000,
    logLevel: "error",
    dashboardEnabled: false,
    dashboardUsername: "admin",
    dashboardPassword: "",
  };
}

interface ProxyHandlerWithInternals extends ProxyHandler {
  tapSseStreamForUsage(
    upstream: ReadableStream<Uint8Array>,
    accountId: string,
    accountName: string,
    responseTime: number,
    method: string,
    path: string,
    statusCode: number,
  ): ReadableStream<Uint8Array>;
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(s));
      controller.close();
    },
  });
}

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

describe("ProxyHandler.tapSseStreamForUsage", () => {
  let handler: ProxyHandlerWithInternals;

  beforeEach(() => {
    clearUsage();
    clearHistory();
    const config = makeConfig();
    const manager = new AccountManager(config);
    handler = new ProxyHandler(
      manager,
      config,
    ) as unknown as ProxyHandlerWithInternals;
  });

  it("harus extract usage dari Anthropic SSE event message_start + message_delta", async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":120,"output_tokens":1,"cache_read_input_tokens":50,"cache_creation_input_tokens":10}}}',
      "",
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"halo"}}',
      "",
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":42}}',
      "",
      "event: message_stop",
      'data: {"type":"message_stop"}',
      "",
      "",
    ].join("\n");

    const upstream = streamFromString(sse);
    const tapped = handler.tapSseStreamForUsage(
      upstream,
      "acc-1",
      "test-account",
      234,
      "POST",
      "/v1/messages",
      200,
    );

    const forwarded = await consumeStream(tapped);
    // Output stream harus identik dengan input (transparent forward)
    expect(forwarded).toBe(sse);

    // Usage harus ke-record dengan benar
    const overview = getUsageOverview();
    expect(overview.totalRequests).toBe(1);
    expect(overview.totalInputTokens).toBe(120);
    expect(overview.totalOutputTokens).toBe(42);
    expect(overview.byModel[0].model).toBe("claude-sonnet-4-20250514");
    expect(overview.byAccount[0].accountId).toBe("acc-1");
    expect(overview.byAccount[0].totalCacheReadTokens).toBe(50);
    expect(overview.byAccount[0].totalCacheWriteTokens).toBe(10);

    // History harus terisi
    const hist = getHistory();
    expect(hist.entries.length).toBe(1);
    expect(hist.entries[0].model).toBe("claude-sonnet-4-20250514");
    expect(hist.entries[0].inputTokens).toBe(120);
    expect(hist.entries[0].outputTokens).toBe(42);
    expect(hist.entries[0].cached).toBe(true);
    expect(hist.entries[0].statusCode).toBe(200);
  });

  it("harus tetep handle SSE yang chunked (boundary di tengah event)", async () => {
    const fullSse =
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-haiku-3-5-20241022","usage":{"input_tokens":10,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n';

    // Split jadi 2 chunks di tengah JSON pertama
    const splitAt = 80;
    const chunk1 = fullSse.slice(0, splitAt);
    const chunk2 = fullSse.slice(splitAt);

    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        controller.enqueue(encoder.encode(chunk2));
        controller.close();
      },
    });

    const tapped = handler.tapSseStreamForUsage(
      upstream,
      "acc-2",
      "haiku-account",
      100,
      "POST",
      "/v1/messages",
      200,
    );

    await consumeStream(tapped);

    const overview = getUsageOverview();
    expect(overview.totalRequests).toBe(1);
    expect(overview.totalInputTokens).toBe(10);
    expect(overview.totalOutputTokens).toBe(5);
    expect(overview.byModel[0].model).toBe("claude-haiku-3-5-20241022");
  });

  it("harus tidak crash kalo SSE stream kosong", async () => {
    const upstream = streamFromString("");
    const tapped = handler.tapSseStreamForUsage(
      upstream,
      "acc-3",
      "empty",
      0,
      "POST",
      "/v1/messages",
      200,
    );
    const result = await consumeStream(tapped);
    expect(result).toBe("");
    // Walau tidak ada usage, masih record sebagai 1 request dengan 0 tokens
    const overview = getUsageOverview();
    expect(overview.totalRequests).toBe(1);
    expect(overview.totalInputTokens).toBe(0);
    expect(overview.totalOutputTokens).toBe(0);
  });

  it("harus skip event yang bukan JSON valid (resilient)", async () => {
    const sse = [
      "event: ping",
      "data: ", // Empty data
      "",
      "event: message_start",
      'data: {"type":"message_start","message":{"model":"claude-3-5-sonnet-20241022","usage":{"input_tokens":15,"output_tokens":1}}}',
      "",
      "event: corrupted",
      "data: {not-valid-json",
      "",
      "event: message_delta",
      'data: {"type":"message_delta","usage":{"output_tokens":7}}',
      "",
      "",
    ].join("\n");

    const upstream = streamFromString(sse);
    const tapped = handler.tapSseStreamForUsage(
      upstream,
      "acc-4",
      "resilient",
      50,
      "POST",
      "/v1/messages",
      200,
    );
    await consumeStream(tapped);

    const overview = getUsageOverview();
    expect(overview.totalRequests).toBe(1);
    expect(overview.totalInputTokens).toBe(15);
    expect(overview.totalOutputTokens).toBe(7);
  });
});
