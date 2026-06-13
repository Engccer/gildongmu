import { describe, it, expect } from "vitest";
import { mergePlaces } from "../providers/places";
import type { Place } from "../types";

/**
 * en 로케일 병합(카카오 기본 + TourAPI 보강)의 중복 제거 로직.
 *
 * 카카오(한글)와 TourAPI(영문)는 같은 장소를 서로 다른 이름·id로 주므로
 * 유일한 공통축인 좌표(WGS84)로만 중복을 판정한다. 두 소스의 좌표는
 * 소수점 아래가 미세하게 다를 수 있어 4자리(약 11m)로 반올림해 비교한다.
 */

function place(over: Partial<Place> & Pick<Place, "id" | "lat" | "lng">): Place {
  return {
    name: "",
    category: "",
    address: "",
    roadAddress: "",
    ...over,
  };
}

describe("mergePlaces", () => {
  it("primary 전부를 먼저 담고, 그 뒤에 secondary를 이어 붙인다", () => {
    const primary = [place({ id: "kakao-1", lat: 37.5, lng: 127.0 })];
    const secondary = [place({ id: "tour-1", lat: 37.6, lng: 127.1 })];

    const merged = mergePlaces(primary, secondary);

    expect(merged.map((p) => p.id)).toEqual(["kakao-1", "tour-1"]);
  });

  it("좌표가 4자리에서 일치하는 secondary 항목은 제외하고 primary를 남긴다", () => {
    const primary = [
      place({ id: "kakao-gbg", name: "경복궁", lat: 37.57882, lng: 126.97689 }),
    ];
    // 같은 경복궁을 TourAPI가 영문명·미세하게 다른 좌표로 준 경우
    const secondary = [
      place({
        id: "tour-gbg",
        name: "Gyeongbokgung Palace",
        lat: 37.578824,
        lng: 126.976891,
      }),
    ];

    const merged = mergePlaces(primary, secondary);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("kakao-gbg");
    expect(merged[0].name).toBe("경복궁");
  });

  it("secondary 내부의 중복 좌표도 한 번만 담는다", () => {
    const primary: Place[] = [];
    const secondary = [
      place({ id: "tour-a", lat: 37.1234, lng: 127.1234 }),
      place({ id: "tour-a2", lat: 37.12341, lng: 127.12339 }),
    ];

    const merged = mergePlaces(primary, secondary);

    expect(merged.map((p) => p.id)).toEqual(["tour-a"]);
  });

  it("빈 입력을 안전하게 처리한다", () => {
    expect(mergePlaces([], [])).toEqual([]);
  });
});
