import { describe, it, expect, vi } from "vitest";
import {
  calculateDelay,
  isRetryableStatus,
  isRateLimitError,
  isAuthError,
  isServerError,
  parseRetryAfter,
  withRetry,
} from "~/lib/retry";

describe("retry", () => {
  describe("calculateDelay()", () => {
    it("harus return base delay untuk attempt 1", () => {
      const delay = calculateDelay(1, 1000, 30000);
      expect(delay).toBeGreaterThanOrEqual(800);
      expect(delay).toBeLessThanOrEqual(1400);
    });

    it("harus exponential increase setiap attempt", () => {
      const d1 = calculateDelay(1, 1000, 30000);
      const d2 = calculateDelay(2, 1000, 30000);
      const d3 = calculateDelay(3, 1000, 30000);
      expect(d2).toBeGreaterThan(d1 * 0.8);
      expect(d3).toBeGreaterThan(d2 * 0.8);
    });

    it("harus cap pada maxDelay", () => {
      const delay = calculateDelay(20, 1000, 5000);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe("isRetryableStatus()", () => {
    it("harus return true untuk 429", () => {
      expect(isRetryableStatus(429, [429, 500, 502, 503, 504])).toBe(true);
    });

    it("harus return true untuk 500", () => {
      expect(isRetryableStatus(500, [429, 500, 502, 503, 504])).toBe(true);
    });

    it("harus return false untuk 400", () => {
      expect(isRetryableStatus(400, [429, 500, 502, 503, 504])).toBe(false);
    });

    it("harus return false untuk 200", () => {
      expect(isRetryableStatus(200, [429, 500, 502, 503, 504])).toBe(false);
    });
  });

  describe("isRateLimitError()", () => {
    it("harus return true untuk 429", () => {
      expect(isRateLimitError(429)).toBe(true);
    });

    it("harus return false untuk lainnya", () => {
      expect(isRateLimitError(200)).toBe(false);
      expect(isRateLimitError(500)).toBe(false);
    });
  });

  describe("isAuthError()", () => {
    it("harus return true untuk 401", () => {
      expect(isAuthError(401)).toBe(true);
    });

    it("harus return true untuk 403", () => {
      expect(isAuthError(403)).toBe(true);
    });

    it("harus return false untuk lainnya", () => {
      expect(isAuthError(200)).toBe(false);
      expect(isAuthError(429)).toBe(false);
    });
  });

  describe("isServerError()", () => {
    it("harus return true untuk 500-599", () => {
      expect(isServerError(500)).toBe(true);
      expect(isServerError(502)).toBe(true);
      expect(isServerError(599)).toBe(true);
    });

    it("harus return false untuk lainnya", () => {
      expect(isServerError(200)).toBe(false);
      expect(isServerError(429)).toBe(false);
    });
  });

  describe("parseRetryAfter()", () => {
    it("harus parse seconds value", () => {
      const headers = new Headers({ "retry-after": "30" });
      const result = parseRetryAfter(headers);
      expect(result).toBeGreaterThan(Date.now());
      expect(result! - Date.now()).toBeLessThanOrEqual(31000);
    });

    it("harus return null jika header tidak ada", () => {
      const headers = new Headers();
      expect(parseRetryAfter(headers)).toBeNull();
    });

    it("harus parse date value", () => {
      const future = new Date(Date.now() + 60000).toUTCString();
      const headers = new Headers({ "retry-after": future });
      const result = parseRetryAfter(headers);
      expect(result).toBeGreaterThan(Date.now());
    });
  });

  describe("withRetry()", () => {
    it("harus return value on first success", async () => {
      const result = await withRetry(async () => "ok", { maxAttempts: 3 });
      expect(result).toBe("ok");
    });

    it("harus retry on retryable error then succeed", async () => {
      let calls = 0;
      const result = await withRetry(
        async () => {
          calls++;
          if (calls < 3) {
            const err = new Error("server error") as Error & { status: number };
            err.status = 500;
            throw err;
          }
          return "ok";
        },
        { maxAttempts: 3, delayBase: 10, delayMax: 50 },
      );
      expect(result).toBe("ok");
      expect(calls).toBe(3);
    });

    it("harus throw setelah semua attempts gagal", async () => {
      await expect(
        withRetry(
          async () => {
            const err = new Error("fail") as Error & { status: number };
            err.status = 500;
            throw err;
          },
          { maxAttempts: 2, delayBase: 10, delayMax: 50 },
        ),
      ).rejects.toThrow("fail");
    });

    it("harus throw immediately untuk non-retryable status", async () => {
      let calls = 0;
      await expect(
        withRetry(
          async () => {
            calls++;
            const err = new Error("bad request") as Error & { status: number };
            err.status = 400;
            throw err;
          },
          { maxAttempts: 3, delayBase: 10 },
        ),
      ).rejects.toThrow("bad request");
      expect(calls).toBe(1);
    });

    it("harus pass retry context ke function", async () => {
      const attempts: number[] = [];
      await withRetry(
        async (ctx) => {
          attempts.push(ctx.attempt);
          if (ctx.attempt < 2) {
            const err = new Error("retry") as Error & { status: number };
            err.status = 500;
            throw err;
          }
          return "done";
        },
        { maxAttempts: 3, delayBase: 10, delayMax: 50 },
      );
      expect(attempts).toEqual([1, 2]);
    });
  });
});
