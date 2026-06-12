import { describe, it, expect } from "vitest";
import {
  buildPlaceDeeplink,
  buildRouteDeeplink,
  buildWebFallbackUrl,
  isInKorea,
} from "../deeplink";

const APPNAME = "space.dodoplanet.gildongmu";
const GYEONGBOKGUNG = { lat: 37.579617, lng: 126.977041, name: "경복궁" };

describe("isInKorea", () => {
  it("한반도 권역 좌표를 통과시킨다", () => {
    expect(isInKorea(37.5665, 126.978)).toBe(true); // 서울
    expect(isInKorea(33.4996, 126.5312)).toBe(true); // 제주
  });

  it("권역 밖 좌표를 거부한다", () => {
    expect(isInKorea(35.6762, 139.6503)).toBe(false); // 도쿄 (경도 초과)
    expect(isInKorea(1.3521, 103.8198)).toBe(false); // 싱가포르
  });
});

describe("buildRouteDeeplink", () => {
  it("대중교통 길찾기 딥링크를 생성한다 (출발지 생략 = 현재 위치)", () => {
    const url = buildRouteDeeplink("public", { dest: GYEONGBOKGUNG }, APPNAME);
    expect(url).toMatch(/^nmap:\/\/route\/public\?/);
    expect(url).toContain("dlat=37.579617");
    expect(url).toContain("dlng=126.977041");
    expect(url).toContain(`appname=${encodeURIComponent(APPNAME)}`);
    expect(url).not.toContain("slat=");
  });

  it("출발지를 지정하면 slat/slng/sname이 포함된다", () => {
    const url = buildRouteDeeplink(
      "walk",
      {
        start: { lat: 37.554648, lng: 126.970697, name: "서울역" },
        dest: GYEONGBOKGUNG,
      },
      APPNAME,
    );
    expect(url).toMatch(/^nmap:\/\/route\/walk\?/);
    expect(url).toContain("slat=37.554648");
    expect(url).toContain(`sname=${encodeURIComponent("서울역")}`);
  });

  it("한반도 권역 밖 목적지는 거부한다", () => {
    expect(() =>
      buildRouteDeeplink(
        "car",
        { dest: { lat: 35.6762, lng: 139.6503, name: "도쿄" } },
        APPNAME,
      ),
    ).toThrow();
  });
});

describe("buildPlaceDeeplink", () => {
  it("장소 핀 딥링크를 생성한다", () => {
    const url = buildPlaceDeeplink(GYEONGBOKGUNG, APPNAME);
    expect(url).toMatch(/^nmap:\/\/place\?/);
    expect(url).toContain(`name=${encodeURIComponent("경복궁")}`);
  });
});

describe("buildWebFallbackUrl", () => {
  it("네이버 웹 지도 검색 URL을 생성한다", () => {
    expect(buildWebFallbackUrl("경복궁")).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent("경복궁")}`,
    );
  });
});
