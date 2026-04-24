import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPKCEChallenge,
  buildAuthorizeUrl,
  startAuth,
  getPendingAuth,
  getLatestPendingAuth,
  removePendingAuth,
  getPendingAuthCount,
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpiringSoon,
  parseAuthorizationCode,
  getClientId,
  getScopes,
} from "~/lib/oauth";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function clearPendingAuths() {
  let count = getPendingAuthCount();
  while (count > 0) {
    const pending = getLatestPendingAuth();
    if (pending) removePendingAuth(pending.challenge.state);
    count = getPendingAuthCount();
  }
}

describe("oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingAuths();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPendingAuths();
  });

  describe("createPKCEChallenge()", () => {
    it("harus generate challenge dengan semua fields", () => {
      const challenge = createPKCEChallenge();
      expect(challenge.codeVerifier).toBeDefined();
      expect(challenge.codeVerifier.length).toBeGreaterThan(0);
      expect(challenge.codeChallenge).toBeDefined();
      expect(challenge.codeChallenge.length).toBeGreaterThan(0);
      expect(challenge.state).toBeDefined();
      expect(challenge.state.length).toBeGreaterThan(0);
    });

    it("harus generate unique challenge setiap kali", () => {
      const a = createPKCEChallenge();
      const b = createPKCEChallenge();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
      expect(a.codeChallenge).not.toBe(b.codeChallenge);
      expect(a.state).not.toBe(b.state);
    });

    it("codeChallenge harus berbeda dari codeVerifier (hashed)", () => {
      const challenge = createPKCEChallenge();
      expect(challenge.codeChallenge).not.toBe(challenge.codeVerifier);
    });
  });

  describe("buildAuthorizeUrl()", () => {
    it("harus return URL dengan semua required params", () => {
      const challenge = createPKCEChallenge();
      const url = buildAuthorizeUrl(challenge);
      expect(url).toContain("https://claude.com/cai/oauth/authorize?");
      expect(url).toContain("client_id=");
      expect(url).toContain("response_type=code");
      expect(url).toContain("redirect_uri=");
      expect(url).toContain("scope=");
      expect(url).toContain("code_challenge=");
      expect(url).toContain("code_challenge_method=S256");
      expect(url).toContain(`state=${challenge.state}`);
    });

    it("harus include code=true param sesuai Claude Code", () => {
      const challenge = createPKCEChallenge();
      const url = buildAuthorizeUrl(challenge);
      expect(url).toContain("code=true");
    });

    it("harus parseable sebagai valid URL", () => {
      const challenge = createPKCEChallenge();
      const url = buildAuthorizeUrl(challenge);
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.hostname).toBe("claude.com");
      expect(parsed.searchParams.get("client_id")).toBe(getClientId());
      expect(parsed.searchParams.get("redirect_uri")).toBe(
        "https://platform.claude.com/oauth/code/callback",
      );
    });
  });

  describe("parseAuthorizationCode()", () => {
    it("harus parse pasted code#state dari halaman Claude Code", () => {
      expect(parseAuthorizationCode("abc123#state456")).toEqual({
        code: "abc123",
        state: "state456",
      });
    });

    it("harus parse callback URL penuh", () => {
      const parsed = parseAuthorizationCode(
        "https://platform.claude.com/oauth/code/callback?code=abc123&state=state456",
      );
      expect(parsed).toEqual({ code: "abc123", state: "state456" });
    });

    it("harus trim quotes, prefix, dan whitespace", () => {
      expect(parseAuthorizationCode('"code: abc 123"')).toEqual({
        code: "abc123",
      });
    });
  });

  describe("startAuth()", () => {
    it("harus create pending auth dan return data lengkap", () => {
      const result = startAuth("Test Account");
      expect(result.challenge).toBeDefined();
      expect(result.authorizeUrl).toContain(
        "https://claude.com/cai/oauth/authorize",
      );
      expect(result.accountName).toBe("Test Account");
      expect(result.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("harus increment pending count", () => {
      expect(getPendingAuthCount()).toBe(0);
      startAuth("A");
      expect(getPendingAuthCount()).toBe(1);
      startAuth("B");
      expect(getPendingAuthCount()).toBe(2);
    });

    it("harus bisa retrieve pending auth by state", () => {
      const result = startAuth("Test");
      const retrieved = getPendingAuth(result.challenge.state);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.accountName).toBe("Test");
    });
  });

  describe("getPendingAuth()", () => {
    it("harus return null untuk state yang tidak ada", () => {
      expect(getPendingAuth("nonexistent")).toBeNull();
    });

    it("harus return null untuk expired auth", () => {
      const result = startAuth("Expired");
      const state = result.challenge.state;
      vi.spyOn(Date, "now").mockReturnValue(result.createdAt + 11 * 60 * 1000);
      expect(getPendingAuth(state)).toBeNull();
      vi.restoreAllMocks();
    });

    it("harus return pending auth yang masih valid", () => {
      const result = startAuth("Valid");
      const pending = getPendingAuth(result.challenge.state);
      expect(pending).not.toBeNull();
      expect(pending?.accountName).toBe("Valid");
    });
  });

  describe("getLatestPendingAuth()", () => {
    it("harus return null kalau tidak ada pending", () => {
      expect(getLatestPendingAuth()).toBeNull();
    });

    it("harus return yang paling baru", () => {
      let tick = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => tick++);
      startAuth("First");
      const second = startAuth("Second");
      const latest = getLatestPendingAuth();
      vi.restoreAllMocks();
      expect(latest?.accountName).toBe("Second");
      expect(latest?.challenge.state).toBe(second.challenge.state);
    });
  });

  describe("removePendingAuth()", () => {
    it("harus remove pending auth by state", () => {
      const result = startAuth("Remove Me");
      expect(getPendingAuthCount()).toBe(1);
      removePendingAuth(result.challenge.state);
      expect(getPendingAuthCount()).toBe(0);
    });

    it("harus tidak error kalau state tidak ada", () => {
      expect(() => removePendingAuth("nope")).not.toThrow();
    });
  });

  describe("getPendingAuthCount()", () => {
    it("harus return 0 kalau kosong", () => {
      expect(getPendingAuthCount()).toBe(0);
    });

    it("harus clean expired sebelum count", () => {
      const result = startAuth("Will Expire");
      expect(getPendingAuthCount()).toBe(1);
      vi.spyOn(Date, "now").mockReturnValue(result.createdAt + 11 * 60 * 1000);
      expect(getPendingAuthCount()).toBe(0);
      vi.restoreAllMocks();
    });
  });

  describe("exchangeCodeForTokens()", () => {
    it("harus return tokens dari successful exchange", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "acc_token_123",
          refresh_token: "ref_token_456",
          expires_in: 7200,
        }),
      });

      const tokens = await exchangeCodeForTokens("code123", "verifier123");
      expect(tokens.accessToken).toBe("acc_token_123");
      expect(tokens.refreshToken).toBe("ref_token_456");
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());
    });

    it("harus kirim request body yang benar", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "tk",
          refresh_token: "rt",
          expires_in: 3600,
        }),
      });

      await exchangeCodeForTokens("mycode", "myverifier", "mystate");
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain("token");
      expect(url).toContain("platform.claude.com");
      expect(opts.headers["Content-Type"]).toBe("application/json");
      expect(opts.headers["User-Agent"]).toBe("anthropic");
      expect(opts.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      const body = JSON.parse(opts.body);
      expect(body.grant_type).toBe("authorization_code");
      expect(body.code).toBe("mycode");
      expect(body.code_verifier).toBe("myverifier");
      expect(body.client_id).toBe(getClientId());
      expect(body.redirect_uri).toBe(
        "https://platform.claude.com/oauth/code/callback",
      );
      expect(body.state).toBe("mystate");
    });

    it("harus throw error kalau response not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "invalid_grant",
      });

      await expect(exchangeCodeForTokens("bad", "bad")).rejects.toThrow(
        "Token exchange failed (400)",
      );
    });

    it("harus throw error kalau response tidak punya access_token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(exchangeCodeForTokens("code", "verifier")).rejects.toThrow(
        "missing access_token",
      );
    });

    it("harus handle missing refresh_token dengan empty string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "at",
          expires_in: 3600,
        }),
      });

      const tokens = await exchangeCodeForTokens("code", "v");
      expect(tokens.refreshToken).toBe("");
    });

    it("harus default expires_in ke 3600 kalau tidak ada", async () => {
      const now = Date.now();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "at",
          refresh_token: "rt",
        }),
      });

      const tokens = await exchangeCodeForTokens("code", "v");
      expect(tokens.expiresAt).toBeGreaterThanOrEqual(now + 3600 * 1000 - 100);
      expect(tokens.expiresAt).toBeLessThanOrEqual(now + 3600 * 1000 + 5000);
    });

    it("harus handle text() error gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error("body consumed");
        },
      });

      await expect(exchangeCodeForTokens("code", "v")).rejects.toThrow(
        "Token exchange failed (500): unknown error",
      );
    });
  });

  describe("refreshAccessToken()", () => {
    it("harus return new tokens dari successful refresh", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new_acc",
          refresh_token: "new_ref",
          expires_in: 3600,
        }),
      });

      const tokens = await refreshAccessToken("old_ref");
      expect(tokens.accessToken).toBe("new_acc");
      expect(tokens.refreshToken).toBe("new_ref");
    });

    it("harus kirim grant_type refresh_token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "at",
          expires_in: 3600,
        }),
      });

      await refreshAccessToken("my_refresh_token");
      expect(mockFetch.mock.calls[0][0]).toContain("platform.claude.com");
      expect(mockFetch.mock.calls[0][1].headers["Content-Type"]).toBe(
        "application/json",
      );
      expect(mockFetch.mock.calls[0][1].headers["User-Agent"]).toBe(
        "anthropic",
      );
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.grant_type).toBe("refresh_token");
      expect(body.refresh_token).toBe("my_refresh_token");
      expect(body.client_id).toBe(getClientId());
    });

    it("harus throw kalau refresh gagal", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "invalid_token",
      });

      await expect(refreshAccessToken("bad")).rejects.toThrow(
        "Token refresh failed (401)",
      );
    });

    it("harus keep old refresh token kalau response ga ada refresh_token baru", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "new_at",
          expires_in: 3600,
        }),
      });

      const tokens = await refreshAccessToken("keep_this");
      expect(tokens.refreshToken).toBe("keep_this");
    });
  });

  describe("isTokenExpiringSoon()", () => {
    it("harus return true kalau token sudah expired", () => {
      expect(isTokenExpiringSoon(Date.now() - 1000)).toBe(true);
    });

    it("harus return true kalau token dalam buffer zone (60s default)", () => {
      expect(isTokenExpiringSoon(Date.now() + 30_000)).toBe(true);
    });

    it("harus return false kalau token masih jauh dari expired", () => {
      expect(isTokenExpiringSoon(Date.now() + 120_000)).toBe(false);
    });

    it("harus respect custom buffer", () => {
      const expiresAt = Date.now() + 5_000;
      expect(isTokenExpiringSoon(expiresAt, 10_000)).toBe(true);
      expect(isTokenExpiringSoon(expiresAt, 3_000)).toBe(false);
    });
  });

  describe("getClientId() & getScopes()", () => {
    it("harus return client id yang valid", () => {
      expect(getClientId()).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    });

    it("harus return scopes yang include user:inference", () => {
      expect(getScopes()).toContain("user:inference");
    });

    it("harus return scopes yang include user:profile", () => {
      expect(getScopes()).toContain("user:profile");
    });
  });
});
