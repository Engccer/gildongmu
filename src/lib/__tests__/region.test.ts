import { describe, it, expect } from "vitest";
import {
  regionOf,
  regionsPresent,
  filterPlacesByRegion,
  type RegionCode,
} from "../region";
import type { Place } from "../types";

function place(id: string, address: string, roadAddress = ""): Place {
  return {
    id,
    name: id,
    category: "음식점 > 카페",
    address,
    roadAddress,
    lat: 37.5,
    lng: 127.0,
  };
}

/**
 * 주소 첫 토큰을 17개 시·도 slug로 정규화한다. 픽스처는 "테라로사" 실검색
 * 응답(카카오 address_name)에서 가져왔다 — 약칭("서울 종로구")과 풀네임
 * ("제주특별자치도 …")이 섞여 들어온다.
 */
describe("regionOf", () => {
  const cases: [string, RegionCode | null][] = [
    // 카카오 실응답 (테라로사 검색)
    ["경기 양평군 서종면 북한강로 992", "gyeonggi"],
    ["제주특별자치도 서귀포시 칠십리로658번길 27-16", "jeju"],
    ["서울 종로구 종로1길 50", "seoul"],
    ["부산 수영구 구락로123번길 20", "busan"],
    // 풀네임 변형
    ["서울특별시 강남구 테헤란로", "seoul"],
    ["경기도 성남시 분당구", "gyeonggi"],
    ["강원특별자치도 춘천시", "gangwon"],
    ["전북특별자치도 전주시", "jeonbuk"],
    ["충청남도 천안시", "chungnam"],
    ["세종특별자치시 한누리대로", "sejong"],
    // 광주(광역시) vs 경기 광주시 — 첫 토큰으로 정확히 구분
    ["광주광역시 동구", "gwangju"],
    ["경기 광주시 경안동", "gyeonggi"],
    // 알 수 없는/빈 주소
    ["", null],
    ["해외 어딘가", null],
  ];

  it.each(cases)("'%s' → %s", (address, expected) => {
    expect(regionOf(place("x", address))).toBe(expected);
  });

  it("지번 주소가 비면 도로명 주소로 폴백한다", () => {
    expect(regionOf(place("x", "", "부산 해운대구 우동"))).toBe("busan");
  });
});

const sample = [
  place("1", "서울 종로구 종로1길 50"),
  place("2", "경기 양평군 서종면"),
  place("3", "부산 수영구 구락로123번길 20"),
  place("4", "서울 강남구 테헤란로"),
  place("5", "해외 어딘가"), // 매칭 실패 → 어느 지역에도 안 들어감
];

describe("regionsPresent", () => {
  it("존재하는 시·도만 표준 순서로 반환(중복 제거, 미매칭 제외)", () => {
    // 표준 순서: 서울 → 부산 → 경기 (대구·인천 등 빈 지역은 생략)
    expect(regionsPresent(sample)).toEqual(["seoul", "busan", "gyeonggi"]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(regionsPresent([])).toEqual([]);
  });

  it("시·도가 하나뿐이면 길이 1 (UI에서 필터 숨김 판단용)", () => {
    expect(
      regionsPresent([place("a", "서울 종로구"), place("b", "서울 강남구")]),
    ).toEqual(["seoul"]);
  });
});

describe("filterPlacesByRegion", () => {
  it("null이면 전체 반환(입력 순서 보존)", () => {
    expect(filterPlacesByRegion(sample, null)).toHaveLength(5);
  });

  it("특정 시·도만 필터", () => {
    expect(filterPlacesByRegion(sample, "seoul").map((p) => p.id)).toEqual([
      "1",
      "4",
    ]);
  });

  it("미매칭 장소는 어떤 지역 필터에도 포함되지 않는다", () => {
    const ids = filterPlacesByRegion(sample, "busan").map((p) => p.id);
    expect(ids).toEqual(["3"]);
  });
});
