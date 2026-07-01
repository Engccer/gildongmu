import { describe, it, expect } from "vitest";
import {
  ATTRACTION_CONTENT_TYPE_ID,
  buildTourAttractionUrl,
  extractTourAttractions,
} from "../tour-api";

// extractTourAttractions는 TourApiItem[]를 받는다(모듈 내부 타입). 테스트는
// 필요한 필드만 갖춘 최소 객체를 캐스팅해 순수 로직(cap·거리)만 검증한다.
function item(
  id: string,
  title: string,
  mapy: string,
  mapx: string,
): Parameters<typeof extractTourAttractions>[0][number] {
  return {
    contentid: id,
    contenttypeid: "76",
    title,
    addr1: "",
    addr2: "",
    mapx,
    mapy,
    tel: "",
    firstimage: "",
  };
}

describe("buildTourAttractionUrl", () => {
  it("contentTypeId=76으로 관광지만, 좌표·sort는 붙이지 않는다", () => {
    const url = buildTourAttractionUrl({
      query: "Gyeongbokgung",
      lat: 37.538,
      lng: 127.143,
    });
    expect(url.searchParams.get("keyword")).toBe("Gyeongbokgung");
    expect(url.searchParams.get("contentTypeId")).toBe("76");
    expect(url.searchParams.get("numOfRows")).toBe("15");
    // 거리순 파라미터는 없다(정확도/제목순 유지).
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("y")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
    expect(ATTRACTION_CONTENT_TYPE_ID).toBe("76");
  });
});

describe("extractTourAttractions", () => {
  // 좌표는 서울 도심 근방. "Namsan Cable Car"를 사용자에 가장 가깝게,
  // "Cheongdo/Gyeongju Namsan"을 멀게 배치해 거리순 정렬을 검증한다.
  const items = [
    item("1", "Cheongdo Namsan Valley", "35.647", "128.734"),
    item("2", "Gyeongju Namsan Mountain", "35.792", "129.222"),
    item("3", "Namsan Cable Car", "37.551", "126.983"),
    item("4", "Namsangol Hanok Village", "37.559", "126.994"),
    item("5", "Seoul Namsan Park", "37.551", "126.990"),
    item("6", "Namsan Outdoor Botanical Garden", "37.548", "126.995"),
  ];

  it("좌표가 없으면 소스(제목) 순서로 cap 5까지 자른다", () => {
    const out = extractTourAttractions(items, { query: "Namsan" });
    expect(out).toHaveLength(5);
    expect(out.map((p) => p.name)).toEqual([
      "Cheongdo Namsan Valley",
      "Gyeongju Namsan Mountain",
      "Namsan Cable Car",
      "Namsangol Hanok Village",
      "Seoul Namsan Park",
    ]);
    expect(out[0]?.distanceMeters).toBeUndefined();
  });

  it("좌표가 있으면 거리순 정렬 — 가까운 서울 남산이 먼 동명보다 위, cap 5", () => {
    const out = extractTourAttractions(items, {
      query: "Namsan",
      lat: 37.554,
      lng: 126.988,
    });
    expect(out).toHaveLength(5);
    // 근접 서울 남산 4곳이 먼 동명(청도·경주)보다 앞선다 — 상위 4위는 전부 서울.
    const top4 = out.slice(0, 4).map((p) => p.name);
    expect(top4).not.toContain("Cheongdo Namsan Valley");
    expect(top4).not.toContain("Gyeongju Namsan Mountain");
    // 거리 오름차순.
    const dists = out.map((p) => p.distanceMeters ?? 0);
    expect([...dists].sort((a, b) => a - b)).toEqual(dists);
    expect(out[0]?.distanceMeters).toBeGreaterThan(0);
  });
});
