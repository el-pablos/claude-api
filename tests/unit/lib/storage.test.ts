import { describe, it, expect, afterEach } from "vitest";
import { loadState, saveStateImmediate, createEmptyState } from "~/lib/storage";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("storage", () => {
  const tmpFile = path.join(
    os.tmpdir(),
    `claude-api-storage-test-${Date.now()}.json`,
  );

  afterEach(async () => {
    try {
      await fs.unlink(tmpFile);
    } catch {}
  });

  describe("createEmptyState()", () => {
    it("harus return state kosong yang valid", () => {
      const state = createEmptyState();
      expect(state.accounts).toEqual([]);
      expect(state.currentIndex).toBe(0);
      expect(state.lastSelectedId).toBeNull();
      expect(state.config.strategy).toBe("round-robin");
    });
  });

  describe("loadState()", () => {
    it("harus return empty state jika file tidak ada", async () => {
      const state = await loadState("/nonexistent/path.json");
      expect(state.accounts).toEqual([]);
    });

    it("harus load state dari file yang valid", async () => {
      const original = createEmptyState();
      original.currentIndex = 5;
      await fs.writeFile(tmpFile, JSON.stringify(original));

      const loaded = await loadState(tmpFile);
      expect(loaded.currentIndex).toBe(5);
    });

    it("harus handle file corrupt", async () => {
      await fs.writeFile(tmpFile, "{{not-json");
      const state = await loadState(tmpFile);
      expect(state.accounts).toEqual([]);
    });

    it("harus handle invalid structure", async () => {
      await fs.writeFile(tmpFile, JSON.stringify({ noAccounts: true }));
      const state = await loadState(tmpFile);
      expect(state.accounts).toEqual([]);
    });
  });

  describe("saveStateImmediate()", () => {
    it("harus save state ke file", async () => {
      const state = createEmptyState();
      state.currentIndex = 42;
      await saveStateImmediate(tmpFile, state);

      const raw = await fs.readFile(tmpFile, "utf-8");
      const loaded = JSON.parse(raw);
      expect(loaded.currentIndex).toBe(42);
    });

    it("harus create directory jika belum ada", async () => {
      const deepFile = path.join(
        os.tmpdir(),
        `claude-api-deep-${Date.now()}`,
        "sub",
        "pool.json",
      );
      const state = createEmptyState();
      await saveStateImmediate(deepFile, state);

      const raw = await fs.readFile(deepFile, "utf-8");
      expect(JSON.parse(raw).accounts).toEqual([]);

      await fs.rm(path.dirname(path.dirname(deepFile)), { recursive: true });
    });

    it("harus overwrite existing file", async () => {
      const state1 = createEmptyState();
      state1.currentIndex = 1;
      await saveStateImmediate(tmpFile, state1);

      const state2 = createEmptyState();
      state2.currentIndex = 99;
      await saveStateImmediate(tmpFile, state2);

      const raw = await fs.readFile(tmpFile, "utf-8");
      expect(JSON.parse(raw).currentIndex).toBe(99);
    });
  });
});
