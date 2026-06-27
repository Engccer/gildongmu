import { describe, it, expect } from "vitest";
import { whereAmIToPlace } from "../where-am-i-place";
import type { WhereAmI } from "../types";

const coord = { lat: 37.538, lng: 127.139 };
const base: WhereAmI = {
  address: { road: "천호대로 1042", jibun: "길동 123" },
  region: "서울특별시 강동구 길동",
  nearestStation: null,
  landmarks: [],
};

describe("whereAmIToPlace", () => {
  it("행정동을 name으로, 좌표를 그대로 쓴다", () => {
    const p = whereAmIToPlace(base, coord);
    expect(p.name).toBe("서울특별시 강동구 길동");
    expect(p.lat).toBe(37.538);
    expect(p.lng).toBe(127.139);
  });

  it("행정동이 없으면 도로명, 그것도 없으면 '현재 위치'", () => {
    expect(whereAmIToPlace({ ...base, region: null }, coord).name).toBe("천호대로 1042");
    expect(
      whereAmIToPlace({ ...base, region: null, address: null }, coord).name,
    ).toBe("현재 위치");
  });

  it("category는 빈 문자열(역 오분류 방지)", () => {
    expect(whereAmIToPlace(base, coord).category).toBe("");
  });

  it("주소 필드를 채운다", () => {
    const p = whereAmIToPlace(base, coord);
    expect(p.roadAddress).toBe("천호대로 1042");
    expect(p.address).toBe("길동 123");
  });
});
