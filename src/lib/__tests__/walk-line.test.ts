import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import { walkLineAxis, walkLineNameKey, walkLineStartKey } from "../walk-line";

describe("walk-line 투영(E42)", () => {
  it("줄 이름·안내 시작 문구가 위원장 확정 렌더와 같다", () => {
    const name = (k: string) => ko.directions[walkLineNameKey(k)!];
    const start = (k: string) => ko.beacon[walkLineStartKey(k)!];
    expect(name("shortest")).toBe("최단 경로");
    expect(name("accessible")).toBe("계단 회피 경로");
    expect(name("broad")).toBe("큰길 경로");
    expect(start("shortest")).toBe("최단 경로로 안내 시작");
    expect(start("accessible")).toBe("계단 회피 경로로 안내 시작");
    expect(start("broad")).toBe("큰길 경로로 안내 시작");
  });

  it("모르는 종류는 null — 이름을 지어 붙이지 않는다", () => {
    expect(walkLineNameKey("scenic")).toBeNull();
    expect(walkLineStartKey("toString")).toBeNull();
  });

  it("안내 요청 축: 최단→variant, 계단 회피→accessible, 큰길·추천→기본", () => {
    expect(walkLineAxis("shortest")).toEqual({ accessible: false, variant: "shortest" });
    expect(walkLineAxis("accessible")).toEqual({ accessible: true, variant: null });
    expect(walkLineAxis("broad")).toEqual({ accessible: false, variant: null });
    expect(walkLineAxis("recommended")).toEqual({ accessible: false, variant: null });
  });
});
