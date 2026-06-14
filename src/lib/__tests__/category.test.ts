import { describe, it, expect } from "vitest";
import {
  categoryOf,
  groupByCategory,
  bucketsPresent,
  filterPlacesByBucket,
  type CategoryBucket,
} from "../category";
import type { Place } from "../types";

/**
 * 카카오 계층 문자열과 TourAPI 라벨을 공통 버킷으로 재분류한다.
 * 샘플 카테고리는 2026-06 경복궁 en 검색 실응답에서 가져왔다.
 */
describe("categoryOf", () => {
  const cases: [string, CategoryBucket][] = [
    // 카카오 계층 문자열
    ["여행 > 관광,명소 > 문화유적 > 고궁,궁", "attraction"],
    ["여행 > 관광,명소 > 문화유적", "attraction"],
    ["교통,수송 > 교통시설 > 주차장", "transport"],
    ["교통,수송 > 지하철,전철 > 수도권3호선", "transport"],
    ["음식점 > 한식 > 육류,고기", "food"],
    ["가정,생활 > 백화점", "shopping"],
    ["여행 > 숙박 > 호텔", "lodging"],
    ["교육,학문 > 학교 > 중학교", "other"],
    // TourAPI 라벨 (국문/영문)
    ["Tourist Attraction", "attraction"],
    ["Cultural Facility", "attraction"],
    ["Restaurant", "food"],
    ["Shopping", "shopping"],
    ["Accommodation", "lodging"],
    ["관광지", "attraction"],
    ["음식점", "food"],
    ["", "other"],
  ];

  it.each(cases)("'%s' → %s", (category, expected) => {
    expect(categoryOf(category)).toBe(expected);
  });
});

describe("groupByCategory", () => {
  function place(id: string, category: string): Place {
    return {
      id,
      name: id,
      category,
      address: "",
      roadAddress: "",
      lat: 37.5,
      lng: 127.0,
    };
  }

  it("버킷을 정해진 순서로 묶고 빈 버킷은 생략한다", () => {
    const places = [
      place("kakao-역", "교통,수송 > 지하철,전철 > 3호선"),
      place("tour-shop", "Shopping"),
      place("kakao-궁", "여행 > 관광,명소 > 문화유적 > 고궁,궁"),
    ];

    const groups = groupByCategory(places);

    // 순서: attraction → shopping → transport (food·lodging·other는 빈 버킷이라 생략)
    expect(groups.map((g) => g.bucket)).toEqual([
      "attraction",
      "shopping",
      "transport",
    ]);
  });

  it("같은 버킷 안에서는 입력 순서를 보존한다", () => {
    const places = [
      place("kakao-궁", "여행 > 관광,명소 > 문화유적 > 고궁,궁"),
      place("tour-palace", "Tourist Attraction"),
    ];

    const groups = groupByCategory(places);

    expect(groups).toHaveLength(1);
    expect(groups[0].places.map((p) => p.id)).toEqual([
      "kakao-궁",
      "tour-palace",
    ]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

const sample = [
  {
    id: "1",
    name: "경복궁",
    category: "관광,명소>고궁",
    address: "",
    roadAddress: "",
    lat: 0,
    lng: 0,
  },
  {
    id: "2",
    name: "김밥천국",
    category: "음식점>분식",
    address: "",
    roadAddress: "",
    lat: 0,
    lng: 0,
  },
  {
    id: "3",
    name: "서울역",
    category: "교통,수송>지하철",
    address: "",
    roadAddress: "",
    lat: 0,
    lng: 0,
  },
];

describe("bucketsPresent", () => {
  it("결과에 존재하는 버킷만 BUCKET_ORDER 순서로 반환", () => {
    expect(bucketsPresent(sample)).toEqual(["attraction", "food", "transport"]);
  });
  it("빈 입력은 빈 배열", () => {
    expect(bucketsPresent([])).toEqual([]);
  });
});

describe("filterPlacesByBucket", () => {
  it("null이면 전체 반환", () => {
    expect(filterPlacesByBucket(sample, null)).toHaveLength(3);
  });
  it("특정 버킷만 필터", () => {
    expect(filterPlacesByBucket(sample, "food").map((p) => p.id)).toEqual(["2"]);
  });
});
