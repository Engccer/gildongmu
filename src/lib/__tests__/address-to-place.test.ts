import { describe, it, expect } from "vitest";
import { jusoAddressToPlace } from "../address-to-place";
import type { JusoAddress } from "../types";

const ADDR: JusoAddress = {
  roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
  roadAddrPart1: "서울특별시 중구 세종대로 110",
  jibunAddr: "서울특별시 중구 태평로1가 31",
  engAddr: "110 Sejong-daero, Jung-gu, Seoul",
  zipNo: "04524",
  bdNm: "서울특별시청",
};

describe("jusoAddressToPlace", () => {
  it("도로명·지번·좌표를 Place로 합성한다", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5663, lng: 126.9779 }, "ko");
    expect(p.roadAddress).toBe("서울특별시 중구 세종대로 110");
    expect(p.address).toBe("서울특별시 중구 태평로1가 31");
    expect(p.lat).toBeCloseTo(37.5663, 4);
    expect(p.lng).toBeCloseTo(126.9779, 4);
  });

  it("건물명이 있으면 이름으로 쓴다", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5, lng: 127 }, "ko");
    expect(p.name).toBe("서울특별시청");
  });

  it("건물명이 없으면 도로명을 이름으로 쓴다", () => {
    const p = jusoAddressToPlace({ ...ADDR, bdNm: "" }, { lat: 37.5, lng: 127 }, "ko");
    expect(p.name).toBe("서울특별시 중구 세종대로 110");
  });

  it("ko 로케일에서는 englishAddress를 채우지 않는다 (영문 누수 방지)", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5, lng: 127 }, "ko");
    expect(p.englishAddress).toBeUndefined();
  });

  it("en 로케일에서는 공식 영문 주소를 채운다", () => {
    const p = jusoAddressToPlace(ADDR, { lat: 37.5, lng: 127 }, "en");
    expect(p.englishAddress).toBe("110 Sejong-daero, Jung-gu, Seoul");
  });

  it("roadAddrPart1이 비면 roadAddr로 폴백한다", () => {
    const p = jusoAddressToPlace(
      { ...ADDR, roadAddrPart1: "" },
      { lat: 37.5, lng: 127 },
      "ko",
    );
    expect(p.roadAddress).toBe("서울특별시 중구 세종대로 110 (태평로1가)");
  });
});
