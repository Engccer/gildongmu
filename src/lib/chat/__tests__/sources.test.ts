import { describe, it, expect } from "vitest";
import { sourceFor, dedupeSources } from "../sources";

describe("sourceFor", () => {
  it("장소 검색은 ko에서 카카오만", () => {
    expect(sourceFor("search_places", { dataLocale: "ko" })).toEqual([
      { label: "source.kakao" },
    ]);
  });
  it("장소 검색은 en에서 카카오+TourAPI", () => {
    expect(sourceFor("search_places", { dataLocale: "en" })).toEqual([
      { label: "source.kakao" },
      { label: "source.tourapi" },
    ]);
  });
  it("자동차 경로는 ko=Tmap·카카오모빌리티 병기, en=NCP", () => {
    expect(sourceFor("get_car_route", { dataLocale: "ko" })).toEqual([
      { label: "source.tmap" },
      { label: "source.kakaomobility" },
    ]);
    expect(sourceFor("get_car_route", { dataLocale: "en" })).toEqual([
      { label: "source.ncp" },
    ]);
  });
  it("도보 경로는 카카오·Tmap 병기(기본 카카오, 폴백 Tmap)", () => {
    expect(sourceFor("get_walk_route", { dataLocale: "ko" })).toEqual([
      { label: "source.kakao" },
      { label: "source.tmap" },
    ]);
  });
  it("공기질은 에어코리아", () => {
    expect(sourceFor("get_air_quality", { dataLocale: "ko" })).toEqual([
      { label: "source.airkorea" },
    ]);
  });
  it("날씨는 기상청", () => {
    expect(sourceFor("get_weather", { dataLocale: "ko" })).toEqual([
      { label: "source.kma" },
    ]);
  });
  it("미등록 도구는 빈 배열", () => {
    expect(sourceFor("unknown_tool", { dataLocale: "ko" })).toEqual([]);
  });
});

describe("dedupeSources", () => {
  it("label 기준 중복제거(첫 등장 보존)", () => {
    const out = dedupeSources([
      { label: "source.kakao" },
      { label: "source.airkorea" },
      { label: "source.kakao" },
    ]);
    expect(out).toEqual([{ label: "source.kakao" }, { label: "source.airkorea" }]);
  });
});

describe("서울 열린데이터 출처 표기(열린데이터광장 이용약관 제10조③, E58 후속 ③)", () => {
  it("ko 라벨이 \"서울특별시 공공데이터\"를 사용한 결과임을 밝힌다 — iOS·안드로이드 정보 출처 화면이 이 키를 쓴다", async () => {
    const ko = (await import("../../../../messages/ko.json")).default as { chat: { source: Record<string, string> } };
    expect(ko.chat.source.seoulopen).toContain("서울특별시 공공데이터");
  });
});

describe("TAGO 출처 이름(A60 위원장 판정 2026-10-05)", () => {
  it("버스 도착과 지하철 첫차·막차가 같은 키를 쓰고, 그 이름은 수단 중립 「국토부 TAGO」다", async () => {
    expect(sourceFor("get_bus_arrivals", { dataLocale: "ko" })).toEqual([{ label: "source.tago" }]);
    expect(sourceFor("get_station_timetable", { dataLocale: "ko" })).toEqual([{ label: "source.tago" }]);
    const ko = (await import("../../../../messages/ko.json")).default;
    const en = (await import("../../../../messages/en.json")).default;
    expect(ko.chat.source.tago).toBe("국토부 TAGO");
    expect(en.chat.source.tago).toBe("MOLIT TAGO");
  });
});
