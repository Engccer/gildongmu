import { describe, it, expect } from "vitest";
import { normalizeDocument } from "../providers/kakao-local";
import {
  buildKakaoPlaceDeeplink,
  buildKakaoRouteDeeplink,
  buildKakaoWebMapUrl,
  buildKakaoWebRouteUrl,
} from "../deeplink-kakao";

describe("normalizeDocument (카카오 로컬)", () => {
  it("카카오 응답 document를 Place로 정규화한다", () => {
    const place = normalizeDocument({
      id: "8129461",
      place_name: "경복궁",
      category_name: "여행 > 관광,명소 > 문화유적 > 고궁,궁",
      category_group_code: "AT4",
      phone: "02-3700-3900",
      address_name: "서울 종로구 세종로 1-91",
      road_address_name: "서울 종로구 사직로 161",
      x: "126.976861357369",
      y: "37.578897287373",
      place_url: "http://place.map.kakao.com/8129461",
      distance: "",
    });
    expect(place.id).toBe("kakao-8129461");
    expect(place.name).toBe("경복궁");
    expect(place.lat).toBeCloseTo(37.5789, 3);
    expect(place.lng).toBeCloseTo(126.9769, 3);
    expect(place.link).toContain("place.map.kakao.com");
  });

  it("빈 전화번호/URL은 undefined", () => {
    const place = normalizeDocument({
      id: "1",
      place_name: "이름",
      category_name: "분류",
      category_group_code: "",
      phone: "",
      address_name: "주소",
      road_address_name: "",
      x: "127.0",
      y: "37.5",
      place_url: "",
      distance: "",
    });
    expect(place.phone).toBeUndefined();
    expect(place.link).toBeUndefined();
  });
});

describe("buildKakaoRouteDeeplink", () => {
  const DEST = { lat: 37.578897, lng: 126.976861, name: "경복궁" };

  it("대중교통 길찾기 — 출발지 생략 시 ep만 포함", () => {
    const url = buildKakaoRouteDeeplink("public", { dest: DEST });
    expect(url).toMatch(/^kakaomap:\/\/route\?/);
    expect(url).toContain("by=publictransit");
    expect(url).toContain(`ep=${encodeURIComponent("37.578897,126.976861")}`);
    expect(url).not.toContain("sp=");
  });

  it("이동 수단 매핑 (공식 소문자): walk→foot, car→car, bike→bicycle", () => {
    expect(buildKakaoRouteDeeplink("walk", { dest: DEST })).toContain(
      "by=foot",
    );
    expect(buildKakaoRouteDeeplink("car", { dest: DEST })).toContain("by=car");
    expect(buildKakaoRouteDeeplink("bike", { dest: DEST })).toContain(
      "by=bicycle",
    );
  });

  it("한반도 권역 밖 목적지는 거부한다", () => {
    expect(() =>
      buildKakaoRouteDeeplink("car", {
        dest: { lat: 35.6762, lng: 139.6503, name: "도쿄" },
      }),
    ).toThrow();
  });
});

describe("buildKakaoPlaceDeeplink", () => {
  it("장소 상세 딥링크를 생성한다 (로컬 API id 체인)", () => {
    expect(buildKakaoPlaceDeeplink("8129461")).toBe(
      "kakaomap://place?id=8129461",
    );
  });
});

describe("카카오맵 웹 URL (미설치 폴백)", () => {
  const DEST = { lat: 37.578897, lng: 126.976861, name: "경복궁" };

  it("길찾기 웹 URL — 수단 세그먼트 매핑 (public→traffic, walk→walk)", () => {
    expect(buildKakaoWebRouteUrl("public", DEST)).toBe(
      `https://map.kakao.com/link/by/traffic/${encodeURIComponent("경복궁")},37.578897,126.976861`,
    );
    expect(buildKakaoWebRouteUrl("walk", DEST)).toContain("/link/by/walk/");
  });

  it("지도 보기 웹 URL을 생성한다", () => {
    expect(buildKakaoWebMapUrl(DEST)).toBe(
      `https://map.kakao.com/link/map/${encodeURIComponent("경복궁")},37.578897,126.976861`,
    );
  });

  it("권역 밖 목적지는 거부한다", () => {
    expect(() =>
      buildKakaoWebRouteUrl("car", {
        lat: 1.35,
        lng: 103.82,
        name: "싱가포르",
      }),
    ).toThrow();
  });
});
