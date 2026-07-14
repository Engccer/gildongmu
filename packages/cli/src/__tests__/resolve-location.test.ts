import { describe, it, expect, vi, beforeEach } from "vitest";

const apiRequest = vi.fn();
const readConfig = vi.fn();
vi.mock("../lib/api-client.js", () => ({ apiRequest, ApiError: class extends Error {} }));
vi.mock("../lib/config.js", () => ({ readConfig }));

beforeEach(() => { apiRequest.mockReset(); readConfig.mockResolvedValue({ apiUrl: "x" }); });

describe("resolveLocation", () => {
  it("--lat/--lng 직접 지정이 최우선", async () => {
    const { resolveLocation } = await import("../lib/resolve-location.js");
    const loc = await resolveLocation({ lat: "37.5", lng: "127.1", near: "강남역" });
    expect(loc).toEqual({ lat: 37.5, lng: 127.1 });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("--near는 /api/geocode 첫 결과", async () => {
    apiRequest.mockResolvedValue({ matches: [{ addressName: "서울 강동구 길동", lat: 37.53, lng: 127.14 }] });
    const { resolveLocation } = await import("../lib/resolve-location.js");
    const loc = await resolveLocation({ near: "길동" });
    expect(loc).toMatchObject({ lat: 37.53, lng: 127.14 });
  });

  it("지오코딩 0건은 명확한 오류(0건 ≠ 네트워크 실패)", async () => {
    apiRequest.mockResolvedValue({ matches: [] });
    const { resolveLocation } = await import("../lib/resolve-location.js");
    await expect(resolveLocation({ near: "존재하지않는곳12345" })).rejects.toThrow(/찾지 못했습니다/);
  });

  it("required인데 아무 위치도 없으면 사용법 안내", async () => {
    const { resolveLocation, LocationError } = await import("../lib/resolve-location.js");
    await expect(resolveLocation({}, { required: true })).rejects.toBeInstanceOf(LocationError);
  });

  it("config location 폴백", async () => {
    readConfig.mockResolvedValue({ apiUrl: "x", location: { label: "길동", lat: 37.53, lng: 127.14 } });
    const { resolveLocation } = await import("../lib/resolve-location.js");
    expect(await resolveLocation({})).toMatchObject({ label: "길동" });
  });
});
