import { vi } from "vitest";

// Mock environment variables for testing
process.env.ENCRYPTION_KEY = "test-encryption-key-32-chars-ok!";
process.env.API_SECRET_KEY = "test-secret-key";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";

// Silence console during tests
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});
