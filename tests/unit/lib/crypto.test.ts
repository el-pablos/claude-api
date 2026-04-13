import { describe, it, expect } from "vitest";
import { encrypt, decrypt, maskApiKey } from "~/lib/crypto";

describe("crypto", () => {
  const key = "test-encryption-key-32-chars-ok!";

  describe("encrypt/decrypt", () => {
    it("harus encrypt dan decrypt dengan benar", () => {
      const plaintext = "sk-ant-api03-test-key-1234567890";
      const encrypted = encrypt(plaintext, key);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(":");
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it("harus menghasilkan ciphertext berbeda setiap kali (random salt/iv)", () => {
      const plaintext = "sk-ant-api03-same-key";
      const enc1 = encrypt(plaintext, key);
      const enc2 = encrypt(plaintext, key);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1, key)).toBe(plaintext);
      expect(decrypt(enc2, key)).toBe(plaintext);
    });

    it("harus throw error jika encryption key kosong", () => {
      expect(() => encrypt("data", "")).toThrow("ENCRYPTION_KEY is required");
    });

    it("harus throw error jika decryption key kosong", () => {
      expect(() => decrypt("a:b:c:d", "")).toThrow(
        "ENCRYPTION_KEY is required",
      );
    });

    it("harus throw error jika format ciphertext invalid", () => {
      expect(() => decrypt("invalid-format", key)).toThrow(
        "Invalid encrypted data format",
      );
    });

    it("harus throw error jika key salah saat decrypt", () => {
      const encrypted = encrypt("secret", key);
      expect(() =>
        decrypt(encrypted, "wrong-key-32-chars-padded-ok!!"),
      ).toThrow();
    });

    it("harus handle string kosong", () => {
      const encrypted = encrypt("", key);
      expect(decrypt(encrypted, key)).toBe("");
    });

    it("harus handle unicode characters", () => {
      const text = "kunci-rahasia-日本語-emoji-🔑";
      const encrypted = encrypt(text, key);
      expect(decrypt(encrypted, key)).toBe(text);
    });
  });

  describe("maskApiKey", () => {
    it("harus mask API key dengan benar", () => {
      const masked = maskApiKey("sk-ant-api03-very-long-key-here");
      expect(masked).toBe("sk-ant-...here");
      expect(masked).not.toContain("api03");
    });

    it("harus return *** untuk key pendek", () => {
      expect(maskApiKey("short")).toBe("***");
      expect(maskApiKey("12345678")).toBe("***");
    });

    it("harus handle key tepat 9 karakter", () => {
      const masked = maskApiKey("123456789");
      expect(masked).toBe("1234567...6789");
    });
  });
});
