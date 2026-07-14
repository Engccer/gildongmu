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
});
