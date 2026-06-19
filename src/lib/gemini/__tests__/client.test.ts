import { describe, it, expect, vi, afterEach } from "vitest";

describe("gemini client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("키 없으면 getGeminiClient가 null", async () => {
    vi.stubEnv("GEMINI_API_KEY", undefined as any);
    const { getGeminiClient } = await import("../client");
    expect(getGeminiClient()).toBeNull();
  });

  it("GEMINI_MODEL 상수가 정의됨", async () => {
    const { GEMINI_MODEL } = await import("../client");
    expect(typeof GEMINI_MODEL).toBe("string");
    expect(GEMINI_MODEL.length).toBeGreaterThan(0);
  });
});
