import { describe, it, expect } from "vitest";
import {
  isAttraction,
  buildAttractionSearchUrl,
  extractAttractions,
} from "../kakao-attractions";
import type { KakaoLocalDocument } from "../kakao-local";

function doc(
  id: string,
  name: string,
  category: string,
  y: string,
  x: string,
): KakaoLocalDocument {
  return {
    id,
    place_name: name,
    category_name: category,
    category_group_code: "",
    phone: "",
    address_name: "",
    road_address_name: "",
    x,
    y,
    place_url: "",
    distance: "",
  };
}

describe("isAttraction", () => {
  it("여행 > 관광,명소로 시작하면 명소(group code 빈 값이어도)", () => {
    expect(isAttraction("여행 > 관광,명소 > 문화유적 > 고궁,궁")).toBe(true);
    expect(isAttraction("여행 > 관광,명소 > 문화유적")).toBe(true);
  });
  it("음식점·주차장·지하철은 명소 아님", () => {
    expect(isAttraction("음식점 > 한식 > 한정식 > 경복궁")).toBe(false);
    expect(isAttraction("교통,수송 > 교통시설 > 주차장")).toBe(false);
  });
});

describe("buildAttractionSearchUrl", () => {
  it("정확도순 — 좌표·sort를 붙이지 않는다", () => {
    const url = buildAttractionSearchUrl({
      query: "경복궁",
      lat: 37.538,
      lng: 127.143,
    });
    expect(url.searchParams.get("query")).toBe("경복궁");
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("y")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
    expect(url.searchParams.get("size")).toBe("15");
  });
});

describe("extractAttractions", () => {
  const docs: KakaoLocalDocument[] = [
    doc("1", "경복궁", "여행 > 관광,명소 > 문화유적 > 고궁,궁", "37.579", "126.977"),
    doc("2", "경복궁 주차장", "교통,수송 > 교통시설 > 주차장", "37.579", "126.976"),
    doc("3", "경복궁 삼계탕", "음식점 > 한식 > 육류,고기", "37.51", "127.10"),
    doc("4", "경복궁 경회루", "여행 > 관광,명소 > 문화유적", "37.580", "126.977"),
    doc("5", "경복궁 근정전", "여행 > 관광,명소 > 문화유적", "37.579", "126.977"),
    doc("6", "경복궁 향원정", "여행 > 관광,명소 > 문화유적", "37.581", "126.977"),
    doc("7", "경복궁 집옥재", "여행 > 관광,명소 > 문화유적", "37.581", "126.978"),
    doc("8", "경복궁 흥례문", "여행 > 관광,명소 > 문화유적", "37.578", "126.977"),
  ];

  it("명소만 남기고, accuracy 순서로 cap 5까지", () => {
    const out = extractAttractions(docs, { query: "경복궁" });
    expect(out.map((p) => p.name)).toEqual([
      "경복궁",
      "경복궁 경회루",
      "경복궁 근정전",
      "경복궁 향원정",
      "경복궁 집옥재",
    ]);
    // 음식점·주차장은 제외.
    expect(out.some((p) => p.name === "경복궁 삼계탕")).toBe(false);
  });

  it("좌표가 있으면 distanceMeters를 채운다", () => {
    const out = extractAttractions(docs, {
      query: "경복궁",
      lat: 37.538,
      lng: 127.143,
    });
    expect(out[0]?.distanceMeters).toBeGreaterThan(0);
  });

  it("좌표가 없으면 distanceMeters 미설정", () => {
    const out = extractAttractions(docs, { query: "경복궁" });
    expect(out[0]?.distanceMeters).toBeUndefined();
  });
});
