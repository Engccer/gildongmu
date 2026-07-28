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
  it("자동차 경로는 ko=카카오모빌리티, en=NCP", () => {
    expect(sourceFor("get_car_route", { dataLocale: "ko" })).toEqual([
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
