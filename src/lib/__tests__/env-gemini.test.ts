import { describe, it, expect, vi, afterEach } from "vitest";

describe("hasGeminiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("키가 있으면 true", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const { hasGeminiKey } = await import("../env");
    expect(hasGeminiKey()).toBe(true);
  });

  it("키가 없으면 false", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined);
    const { hasGeminiKey } = await import("../env");
    expect(hasGeminiKey()).toBe(false);
  });
});
