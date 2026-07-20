import { describe, it, expect } from "vitest";
import {
  categoryOf,
  bucketsPresent,
  filterPlacesByBucket,
  type CategoryBucket,
} from "../category";

/**
 * 카카오 계층 문자열·네이버 카테고리·TourAPI 라벨을 공통 버킷으로 재분류한다.
 * 샘플 카테고리는 전부 실호출 응답에서 가져왔다(2026-06 경복궁 en,
 * 2026-07-20 키자니아, 2026-07-21 신명중학교·롯데타워·키즈카페·강동구청·
 * 이룸센터·곰두리).
 */
describe("categoryOf", () => {
  const cases: [string, CategoryBucket][] = [
    // 카카오 계층 문자열
    ["여행 > 관광,명소 > 문화유적 > 고궁,궁", "attraction"],
    ["여행 > 관광,명소 > 문화유적", "attraction"],
    ["여행 > 관광,명소 > 광장", "attraction"],
    ["교통,수송 > 교통시설 > 주차장", "transport"],
    ["교통,수송 > 지하철,전철 > 수도권3호선", "transport"],
    ["음식점 > 한식 > 육류,고기", "food"],
    ["음식점 > 카페 > 테마카페", "food"],
    ["가정,생활 > 백화점", "shopping"],
    ["여행 > 숙박 > 호텔", "lodging"],
    // 공공·교육 버킷 — 학교·관공서·복지시설이 기타로 뭉개지던 회귀
    // (2026-07-21 신명중학교·강동구청·이룸센터 실측)
    ["교육,학문 > 학교 > 중학교", "public"],
    ["사회,공공기관 > 지방행정기관 > 구청", "public"],
    ["사회,공공기관 > 단체,협회 > 사회복지시설 > 장애인복지시설", "public"],
    ["교육,학문 > 교육단체 > 체험학습장", "public"],
    ["사회,복지 > 장애인복지시설", "public"], // 네이버
    ["공공,사회기관 > 청소년시설", "public"], // 네이버
    // 미지 카테고리는 정직하게 other(버킷은 순위를 결정하지 않는다)
    ["부동산 > 빌딩", "other"], // 롯데월드타워
    ["스포츠,레저 > 스포츠시설 > 체육관", "other"], // 서울곰두리체육센터
    ["금융,보험 > 금융서비스 > 은행 > 신한은행", "other"],
    // 회귀: 카카오 최상위 "문화,예술"(사진관 등 비명소)이 단독 '문화' 키워드로
    // attraction에 잘못 묶였다(2026-07-20 "키자니아" 검색 실측 — 인생네컷이 관광·명소 섹션에)
    ["문화,예술 > 사진 > 사진관,포토스튜디오 > 즉석사진 > 인생네컷", "other"],
    // 회귀: '미술' 단독 키워드가 "미술,공예" 공방 트리를 attraction으로 오탐
    // (2026-07-21 이룸센터 검색 실측 — 가죽공예 공방이 관광·명소에)
    ["문화,예술 > 미술,공예 > 가죽공예", "other"],
    ["문화,예술 > 문화시설 > 미술관", "attraction"],
    // 회귀: '카페' 키워드가 "키즈카페"(놀이시설)에 부분 매칭 → 음식 오탐
    // (2026-07-21 키즈카페 검색 실측)
    ["가정,생활 > 유아 > 놀이시설 > 키즈카페", "other"],
    ["가정,생활 > 유아 > 놀이시설 > 키즈카페 > 서울형키즈카페", "other"],
    // TourAPI 라벨 (국문/영문)
    ["Tourist Attraction", "attraction"],
    ["Cultural Facility", "attraction"],
    ["Restaurant", "food"],
    ["Shopping", "shopping"],
    ["Accommodation", "lodging"],
    ["관광지", "attraction"],
    ["문화시설", "attraction"],
    ["음식점", "food"],
    ["", "other"],
  ];

  it.each(cases)("'%s' → %s", (category, expected) => {
    expect(categoryOf(category)).toBe(expected);
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
  {
    id: "4",
    name: "강동구청",
    category: "사회,공공기관 > 지방행정기관 > 구청",
    address: "",
    roadAddress: "",
    lat: 0,
    lng: 0,
  },
];

describe("bucketsPresent", () => {
  it("결과에 존재하는 버킷만 BUCKET_ORDER 순서로 반환", () => {
    expect(bucketsPresent(sample)).toEqual([
      "attraction",
      "public",
      "food",
      "transport",
    ]);
  });
  it("빈 입력은 빈 배열", () => {
    expect(bucketsPresent([])).toEqual([]);
  });
});

describe("filterPlacesByBucket", () => {
  it("null이면 전체 반환", () => {
    expect(filterPlacesByBucket(sample, null)).toHaveLength(4);
  });
  it("특정 버킷만 필터", () => {
    expect(filterPlacesByBucket(sample, "food").map((p) => p.id)).toEqual(["2"]);
  });
  it("public 버킷 필터", () => {
    expect(filterPlacesByBucket(sample, "public").map((p) => p.id)).toEqual(["4"]);
  });
});
