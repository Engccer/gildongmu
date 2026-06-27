import { describe, it, expect } from "vitest";
import { pickRegionDocument } from "../kakao-address";

describe("pickRegionDocument", () => {
  const H = { region_type: "H", address_name: "서울특별시 강동구 길동" } as const;
  const B = { region_type: "B", address_name: "서울특별시 강동구 길동" } as const;

  it("행정동(H)을 법정동(B)보다 우선한다", () => {
    expect(pickRegionDocument([B, H])?.region_type).toBe("H");
  });

  it("H가 없으면 B를 쓴다", () => {
    expect(pickRegionDocument([B])?.region_type).toBe("B");
  });

  it("빈 배열이면 null", () => {
    expect(pickRegionDocument([])).toBeNull();
  });
});
