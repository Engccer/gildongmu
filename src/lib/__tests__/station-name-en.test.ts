import { describe, expect, it } from "vitest";
import { stationPlaceNameEn } from "../station-name-en";

const SUBWAY = "교통,수송 > 지하철,전철 > 수도권5호선";

describe("stationPlaceNameEn", () => {
  it("역 POI는 seed 영문 역명 + Station, 노선 표 영문", () => {
    expect(
      stationPlaceNameEn({ id: "k1", name: "여의도역 5호선", category: SUBWAY, lat: 37.5216, lng: 126.9242 }),
    ).toBe("Yeouido Station, Line 5");
  });

  it("seed 영문이 이미 Station으로 끝나면 덧붙이지 않는다", () => {
    expect(
      stationPlaceNameEn({
        id: "k2", name: "서울역 1호선", category: "교통,수송 > 지하철,전철 > 수도권1호선", lat: 37.5547, lng: 126.9707,
      }),
    ).toBe("Seoul Station, Line 1");
  });

  it("seed 영문의 괄호 부기명은 뺀다", () => {
    expect(
      stationPlaceNameEn({
        id: "k7", name: "천호역 8호선", category: "교통,수송 > 지하철,전철 > 수도권8호선", lat: 37.5386, lng: 127.1236,
      }),
    ).toBe("Cheonho Station, Line 8");
  });

  it("노선 토큰이 표에 없으면 undefined(반쪽 영문 금지)", () => {
    expect(
      stationPlaceNameEn({ id: "k3", name: "여의도역 미지선", category: SUBWAY, lat: 37.5216, lng: 126.9242 }),
    ).toBeUndefined();
  });

  it("출구 POI·역 아닌 장소는 대상이 아니다", () => {
    expect(
      stationPlaceNameEn({
        id: "k4", name: "여의도역 5호선 5번출구", category: "교통,수송 > 지하철,전철 > 지하철출구", lat: 37.5216, lng: 126.9242,
      }),
    ).toBeUndefined();
    expect(
      stationPlaceNameEn({ id: "k5", name: "스타벅스 여의도역점", category: "음식점 > 카페", lat: 37.5216, lng: 126.9242 }),
    ).toBeUndefined();
  });

  it("같은 이름이라도 좌표 600m 밖 seed는 쓰지 않는다(동명이역)", () => {
    // 여의도역 이름에 부산 좌표 — 근처에 같은 이름 역이 없다
    expect(
      stationPlaceNameEn({ id: "k6", name: "여의도역 5호선", category: SUBWAY, lat: 35.1796, lng: 129.0756 }),
    ).toBeUndefined();
  });
});
