import { describe, it, expect } from "vitest";
import { coordSchema } from "../route-coord-schema";

describe("coordSchema", () => {
  it("'위도,경도' 문자열을 {lat,lng}로 변환한다", () => {
    expect(coordSchema.parse("37.535,127.140")).toEqual({ lat: 37.535, lng: 127.14 });
  });
  it("형식 위반은 실패한다", () => {
    expect(coordSchema.safeParse("127.140;37.535").success).toBe(false);
  });
  it("한반도 권역 밖 좌표는 거부한다", () => {
    expect(coordSchema.safeParse("48.85,2.35").success).toBe(false);
  });
});
