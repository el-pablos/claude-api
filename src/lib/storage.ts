import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { PoolState } from "./types";
import { logger } from "./logger";

const DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;

export async function loadState(filePath: string): Promise<PoolState> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PoolState;
    if (!Array.isArray(parsed.accounts)) {
      throw new Error("Invalid pool state: accounts is not an array");
    }
    logger.info("Pool state loaded", {
      path: filePath,
      accounts: parsed.accounts.length,
    });
    return parsed;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      logger.info("No existing pool state, starting fresh", { path: filePath });
      return createEmptyState();
    }
    logger.warn("Failed to load pool state, starting fresh", {
      path: filePath,
      error: error.message,
    });
    return createEmptyState();
  }
}

export function saveState(filePath: string, state: PoolState): void {
  pendingSave = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveStateImmediate(filePath, state).catch((err) => {
      logger.error("Failed to save pool state", {
        error: (err as Error).message,
      });
    });
  }, DEBOUNCE_MS);
}

export async function saveStateImmediate(
  filePath: string,
  state: PoolState,
): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = false;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fsp.mkdir(dir, { recursive: true });
  }
  const json = JSON.stringify(state, null, 2);
  await fsp.writeFile(filePath, json, "utf-8");
  logger.debug("Pool state saved", { path: filePath });
}

export function hasPendingSave(): boolean {
  return pendingSave;
}

export function createEmptyState(): PoolState {
  return {
    accounts: [],
    currentIndex: 0,
    lastSelectedId: null,
    config: {
      strategy: "round-robin",
    },
  };
}
