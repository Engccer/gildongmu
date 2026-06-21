import { describe, it, expect } from "vitest";
import type { ExecutionContext } from "../types";
import { anchorOf } from "../router";

function ctx(over: Partial<ExecutionContext>): ExecutionContext {
  return { locale: "ko", dataLocale: "ko", ...over };
}

describe("anchorOf", () => {
  it("placeAnchor가 있으면 장소 좌표를 쓴다", () => {
    const c = ctx({
      userLocation: { lat: 1, lng: 1 },
      placeAnchor: { lat: 37.58, lng: 126.97, name: "경복궁" },
    });
    expect(anchorOf(c)).toEqual({ lat: 37.58, lng: 126.97, name: "경복궁" });
  });

  it("placeAnchor가 없으면 현재 위치를 쓴다", () => {
    const c = ctx({ userLocation: { lat: 2, lng: 3 } });
    expect(anchorOf(c)).toEqual({ lat: 2, lng: 3 });
  });

  it("둘 다 없으면 undefined", () => {
    expect(anchorOf(ctx({}))).toBeUndefined();
  });
});
