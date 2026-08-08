import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAddressCoord } from "../resolve-address-coord";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));
}

describe("resolveAddressCoord", () => {
  it("좌표를 찾으면 resolved", async () => {
    stubFetch(200, { matches: [{ lat: 37.5, lng: 127.1, addressName: "서울 강동구 성내로 12" }] });
    expect(await resolveAddressCoord("서울 강동구 성내로 12")).toEqual({
      kind: "resolved", lat: 37.5, lng: 127.1,
    });
  });

  it("매칭 0건은 empty", async () => {
    stubFetch(200, { matches: [] });
    expect(await resolveAddressCoord("없는 주소")).toEqual({ kind: "empty" });
  });

  it("upstream 실패는 failed — empty로 뭉개지 않는다", async () => {
    stubFetch(502, {});
    expect(await resolveAddressCoord("서울 강동구 성내로 12")).toEqual({ kind: "failed" });
  });

  it("네트워크 예외도 failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await resolveAddressCoord("서울 강동구 성내로 12")).toEqual({ kind: "failed" });
  });

  it("빈 질의는 invalid", async () => {
    expect(await resolveAddressCoord("   ")).toEqual({ kind: "invalid" });
  });
});
