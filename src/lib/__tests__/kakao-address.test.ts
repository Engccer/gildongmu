import { describe, it, expect } from "vitest";
import { normalizeAddressDocument } from "../providers/kakao-address";

describe("normalizeAddressDocument (카카오 로컬 주소 검색)", () => {
  it("도로명 주소 document를 AddressMatch로 정규화한다", () => {
    // 2026-06-13 실호출 응답("서울 종로구 사직로 161") 축약 픽스처
    const match = normalizeAddressDocument({
      address_name: "서울 종로구 사직로 161",
      address_type: "ROAD_ADDR",
      x: "126.976842133821",
      y: "37.5759040910202",
      address: { address_name: "서울 종로구 세종로 1-1" },
      road_address: {
        address_name: "서울 종로구 사직로 161",
        building_name: "경복궁",
        zone_no: "03045",
      },
    });
    expect(match.addressName).toBe("서울 종로구 사직로 161");
    expect(match.roadAddress).toBe("서울 종로구 사직로 161");
    expect(match.jibunAddress).toBe("서울 종로구 세종로 1-1");
    expect(match.postalCode).toBe("03045");
    expect(match.lat).toBeCloseTo(37.5759, 3);
    expect(match.lng).toBeCloseTo(126.9768, 3);
  });

  it("지번 전용(road_address null) document도 처리한다", () => {
    const match = normalizeAddressDocument({
      address_name: "서울 종로구 세종로 1-1",
      address_type: "REGION_ADDR",
      x: "126.97",
      y: "37.57",
      address: { address_name: "서울 종로구 세종로 1-1" },
      road_address: null,
    });
    expect(match.roadAddress).toBeUndefined();
    expect(match.postalCode).toBeUndefined();
    expect(match.jibunAddress).toBe("서울 종로구 세종로 1-1");
  });
});
