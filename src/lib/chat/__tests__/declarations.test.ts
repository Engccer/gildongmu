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

  // get_subway_arrivals — SEOUL_SUBWAY_REALTIME_KEY 게이트
  it("지하철 실시간 키 있으면 get_subway_arrivals 노출", async () => {
    vi.stubEnv("SEOUL_SUBWAY_REALTIME_KEY", "s");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_subway_arrivals")).toBe(true);
  });

  it("지하철 실시간 키 없으면 get_subway_arrivals 미노출", async () => {
    vi.stubEnv("SEOUL_SUBWAY_REALTIME_KEY", undefined as any);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_subway_arrivals")).toBe(false);
  });

  // get_night_clinics — DATA_GO_KR_API_KEY 게이트
  it("data.go.kr 키 있으면 get_night_clinics 노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", "d");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_night_clinics")).toBe(true);
  });

  it("data.go.kr 키 없으면 get_night_clinics 미노출", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined as any);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_night_clinics")).toBe(false);
  });

  // get_kids_places — KAKAO_REST_API_KEY 게이트
  it("카카오 키 있으면 get_kids_places 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_kids_places")).toBe(true);
  });

  it("카카오 키 없으면 get_kids_places 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined as any);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_kids_places")).toBe(false);
  });

  // get_surroundings — KAKAO_REST_API_KEY 게이트
  it("카카오 키 있으면 get_surroundings 노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "k");
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_surroundings")).toBe(true);
  });

  it("카카오 키 없으면 get_surroundings 미노출", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", undefined as any);
    const { availableDeclarations } = await import("../declarations");
    expect(availableDeclarations().some((d) => d.name === "get_surroundings")).toBe(false);
  });
});
