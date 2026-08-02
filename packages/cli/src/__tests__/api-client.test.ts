import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(() => {
  process.env.GILDONGMU_CONFIG_DIR = mkdtempSync(join(tmpdir(), "gil-"));
  process.env.GILDONGMU_API_URL = "https://example.test";
});

describe("apiRequest", () => {
  it("query 조립 + JSON 파싱", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://example.test/api/places?query=%EA%B8%B8%EB%8F%99&lat=37.5");
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    }));
    const { apiRequest } = await import("../lib/api-client.js");
    const res = await apiRequest<{ places: unknown[] }>("/api/places", { query: { query: "길동", lat: "37.5", lng: undefined } });
    expect(res.places).toEqual([]);
  });

  it("HTTP 오류 → ApiError(exitCode=Error), 서버 error 메시지 보존", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "upstream 실패" }), { status: 502 })));
    const { apiRequest, ApiError } = await import("../lib/api-client.js");
    await expect(apiRequest("/api/weather/nearby")).rejects.toMatchObject({ status: 502, message: "upstream 실패" });
  });

  it("네트워크 실패 → exitCode=Network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { apiRequest } = await import("../lib/api-client.js");
    await expect(apiRequest("/api/places")).rejects.toMatchObject({ exitCode: 7 });
  });

  it("HTTP 200 + outOfCoverage:true는 throw하지 않고 마커 바디를 그대로 반환한다(오류 아님)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ outOfCoverage: true }), { status: 200 })));
    const { apiRequest } = await import("../lib/api-client.js");
    const res = await apiRequest("/api/where-am-i");
    expect(res).toEqual({ outOfCoverage: true });
  });
});

describe("isOutOfCoverage", () => {
  it("outOfCoverage:true 바디를 감지한다", async () => {
    const { isOutOfCoverage } = await import("../lib/api-client.js");
    expect(isOutOfCoverage({ outOfCoverage: true })).toBe(true);
  });

  it("정상 응답·null·문자열·outOfCoverage:false는 감지하지 않는다", async () => {
    const { isOutOfCoverage } = await import("../lib/api-client.js");
    expect(isOutOfCoverage({ stations: [] })).toBe(false);
    expect(isOutOfCoverage({ outOfCoverage: false })).toBe(false);
    expect(isOutOfCoverage(null)).toBe(false);
    expect(isOutOfCoverage("outOfCoverage")).toBe(false);
    expect(isOutOfCoverage(undefined)).toBe(false);
  });
});

describe("unavailableHereReason", () => {
  it("아는 사유는 그대로 돌려준다", async () => {
    const { unavailableHereReason } = await import("../lib/api-client.js");
    expect(unavailableHereReason({ unavailableHere: "seoulOnly" })).toBe("seoulOnly");
    expect(unavailableHereReason({ unavailableHere: "noBusData" })).toBe("noBusData");
  });

  it("그 외에는 null: 모르는 사유는 일반 경로로 흘려보낸다", async () => {
    const { unavailableHereReason } = await import("../lib/api-client.js");
    expect(unavailableHereReason({ stations: [] })).toBeNull();
    expect(unavailableHereReason({ outOfCoverage: true })).toBeNull();
    expect(unavailableHereReason({ unavailableHere: true })).toBeNull();
    // 서버가 사유를 늘려도 낡은 CLI가 틀린 문장을 말하지 않는다.
    expect(unavailableHereReason({ unavailableHere: "someFutureReason" })).toBeNull();
    expect(unavailableHereReason(null)).toBeNull();
    expect(unavailableHereReason("seoulOnly")).toBeNull();
  });

  it("사유마다 다른 문구를 준다", async () => {
    const { unavailableHereNotice } = await import("../lib/api-client.js");
    expect(unavailableHereNotice("seoulOnly")).not.toBe(unavailableHereNotice("noBusData"));
    expect(unavailableHereNotice("noBusData")).toContain("정류소");
  });
});
