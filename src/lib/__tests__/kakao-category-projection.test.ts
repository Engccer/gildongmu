import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDocument } from "@/lib/providers/kakao-local";
import { normalizeKidsDoc } from "@/lib/providers/kids-places";
import { normalizeSurroundingDoc } from "@/lib/providers/surroundings";
import { kidsPlaceToPlace, sceneItemToPlace, surroundingPlaceToPlace } from "@/lib/nearby-place";
import { isStation } from "@/lib/station-match";
import { categoryOf } from "@/lib/category";
import type { Place } from "@/lib/types";

// A28 서버 투영(spec §4): 카카오 원문을 드는 provider 3종이 `categoryEn`을 additive로 싣고, 미등재 경로는
// 키 자체가 없다(`null` 금지 — wire 계약은 "부재"). 투영 3종은 그대로 나르고 판정 축은 원문만 읽는다.

const doc = {
  id: "1", place_name: "신명중학교", category_name: "교육,학문 > 학교 > 중학교", category_group_code: "SC4",
  phone: "", address_name: "서울 강동구 명일동 1", road_address_name: "서울 강동구 고덕로 1", x: "127.15", y: "37.55",
  place_url: "", distance: "1463",
};

describe("provider 투영 — categoryEn additive", () => {
  it("kakao-local: 전부 등재 경로는 categoryEn, 미등재 경로는 키 부재(null 아님)", () => {
    const p = normalizeDocument(doc);
    expect(p.category).toBe("교육,학문 > 학교 > 중학교");
    expect(p.categoryEn).toBe("Education & Academia > School > Middle School");
    const q = normalizeDocument({ ...doc, category_name: "교육,학문 > 학교 > 미등재세그먼트" });
    expect("categoryEn" in q).toBe(false);
    expect(JSON.stringify(q)).not.toContain("categoryEn");
  });

  it("kids-places: 화이트리스트 통과 doc에 categoryEn", () => {
    const k = normalizeKidsDoc({ ...doc, place_name: "길동키즈카페", category_name: "가정,생활 > 유아 > 놀이시설 > 키즈카페" } as never);
    expect(k?.categoryEn).toBe("Home & Living > Kids > Play Facility > Kids Cafe");
    expect(kidsPlaceToPlace(k!).categoryEn).toBe("Home & Living > Kids > Play Facility > Kids Cafe");
    expect(kidsPlaceToPlace(k!).category).toBe("가정,생활 > 유아 > 놀이시설 > 키즈카페");
  });

  it("surroundings: categoryRaw 옆 categoryEn, 투영도 나른다", () => {
    const s = normalizeSurroundingDoc(
      { ...doc, place_name: "강동역 3번출구", category_name: "교통,수송 > 지하철,전철 > 수도권5호선", category_group_code: "SW8" } as never,
      37.55, 127.15,
    );
    expect(s?.categoryEn).toBe("Transportation > Subway > Line 5");
    const p = surroundingPlaceToPlace(s!);
    expect(p.category).toBe("교통,수송 > 지하철,전철 > 수도권5호선");
    expect(p.categoryEn).toBe("Transportation > Subway > Line 5");
  });

  it("scene 항목 투영도 나른다", () => {
    const p = sceneItemToPlace({
      name: "CU", distanceMeters: 40, road: null, category: "convenience", id: "kakao-4", lat: 37.5, lng: 127.1,
      categoryRaw: "가정,생활 > 편의점 > CU", categoryEn: "Home & Living > Convenience Store > CU", roadAddress: null,
    });
    expect(p.categoryEn).toBe("Home & Living > Convenience Store > CU");
    expect(p.category).toBe("가정,생활 > 편의점 > CU");
  });
});

describe("판정 축은 원문만 읽는다 — 상충하는 categoryEn 주입에도 결과 불변(리뷰 #7)", () => {
  const base: Place = {
    id: "x", name: "강동역 5호선", category: "교통,수송 > 지하철,전철 > 수도권5호선", address: "", roadAddress: "",
    lat: 37.5, lng: 127.1,
  };
  it("isStation·categoryOf", () => {
    const conflicting = { ...base, categoryEn: "Restaurants > Korean > Meat" };
    expect(isStation(conflicting)).toBe(isStation(base));
    expect(categoryOf(conflicting.category)).toBe(categoryOf(base.category));
    const food: Place = { ...base, name: "갈비집", category: "음식점 > 한식 > 육류,고기", categoryEn: "Transportation > Subway" };
    expect(isStation(food)).toBe(false);
    expect(categoryOf(food.category)).toBe("food");
  });

  // 소스 가드(2선): 판정 모듈·채팅 계층·Kit 판정 파일에 `categoryEn`·`pickCategory`가 등장하면 실패.
  it("판정 모듈 소스에 categoryEn·pickCategory 참조 0", () => {
    const files = [
      "src/lib/station-match.ts",
      "src/lib/category.ts",
      "src/lib/chat/router.ts",
      "src/lib/chat/system-instruction.ts",
      "src/lib/chat/declarations.ts",
      "ios/GildongmuKit/Sources/GildongmuKit/StationMatch.swift",
      "ios/GildongmuKit/Sources/GildongmuKit/SearchFilters.swift",
      "ios/GildongmuKit/Sources/GildongmuKit/PlaceChatPrompts.swift",
      "ios/Gildongmu/Chat/ChatModel.swift",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("categoryEn"), f).toBe(false);
      expect(src.includes("pickCategory"), f).toBe(false);
    }
  });
});
