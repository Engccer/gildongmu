// declarations.test.ts — 키 게이트별 도구 노출 여부 테스트
import { describe, it, expect, vi, afterEach } from "vitest";

describe("availableDeclarations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("카카오 키 있으면 search_places 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_places")).toBe(true);
  });

  it("카카오 키 없으면 search_places 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined as any);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_places")).toBe(false);
  });

  it("juso 키 있으면 search_address 노출", async () => {
    vi.stubEnv("JUSO_CONFM_KEY", "j");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_address")).toBe(true);
  });

  it("juso 키 없으면 search_address 미노출", async () => {
    vi.stubEnv("JUSO_CONFM_KEY", undefined as any);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "search_address")).toBe(false);
  });
});
