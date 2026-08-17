import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPlaces } from "../providers/places";
import { searchPlacesKakaoLocal } from "../providers/kakao-local";
import { searchPlacesNaverLocal } from "../providers/naver-local";
import { hasKakaoKey, hasNaverLocalKeys, hasTourApiKey } from "../env";
import type { Place, PlaceSearchResult } from "../types";

/**
 * searchPlaces 진입점 — provider 선택 자체는 각 병합 테스트(places-merge-*)가
 * 커버하므로, 여기서는 "거리 표기는 searchPlaces가 좌표 존재 시 일원화해
 * annotateDistances로 부여하고, 정렬은 하지 않는다"만 검증한다(2026-07-20 전환).
 */
vi.mock("../providers/kakao-local");
vi.mock("../providers/naver-local");
vi.mock("../env", () => ({
  hasKakaoKey: vi.fn(),
  hasNaverLocalKeys: vi.fn(() => false),
  hasTourApiKey: vi.fn(() => false),
  hasJusoKey: vi.fn(() => false),
  hasNcpMapsKeys: vi.fn(() => false),
  env: {},
}));

const kakaoMock = vi.mocked(searchPlacesKakaoLocal);
const naverMock = vi.mocked(searchPlacesNaverLocal);
const hasKakao = vi.mocked(hasKakaoKey);
const hasNaver = vi.mocked(hasNaverLocalKeys);
const hasTour = vi.mocked(hasTourApiKey);

function result(places: Place[]): PlaceSearchResult {
  return { provider: "kakao-local", places, query: "q" };
}
function place(id: string, lat: number, lng: number): Place {
  return { id, name: id, category: "", address: "", roadAddress: "", lat, lng };
}

describe("searchPlaces (거리 표기 일원화)", () => {
  beforeEach(() => {
    kakaoMock.mockReset();
    hasKakao.mockReset();
    hasNaver.mockReset();
    hasTour.mockReset();
    hasKakao.mockReturnValue(true);
    hasNaver.mockReturnValue(false);
    hasTour.mockReturnValue(false);
  });

  it("좌표가 있으면 정렬 없이 distanceMeters를 부여한다(provider 순서 보존)", async () => {
    kakaoMock.mockResolvedValue(
      result([place("far", 38.0, 128.0), place("near", 37.5, 127.001)]),
    );

    const res = await searchPlaces({ query: "q", lat: 37.5, lng: 127.0 });

    // provider가 준 순서 그대로 — 정렬하지 않는다.
    expect(res.places.map((p) => p.id)).toEqual(["far", "near"]);
    expect(res.places[0].distanceMeters).toBeGreaterThan(res.places[1].distanceMeters!);
  });

  it("좌표가 없으면 distanceMeters를 부여하지 않는다", async () => {
    kakaoMock.mockResolvedValue(result([place("a", 37.5, 127.0)]));

    const res = await searchPlaces({ query: "q" });

    expect(res.places[0].distanceMeters).toBeUndefined();
  });
});

describe("searchPlaces (sort=review — 네이버 단독, spec 2026-08-17 §2·§3.1)", () => {
  beforeEach(() => {
    kakaoMock.mockReset();
    naverMock.mockReset();
    hasKakao.mockReturnValue(true);
    hasNaver.mockReturnValue(true);
    hasTour.mockReturnValue(false);
    kakaoMock.mockResolvedValue(result([place("kakao-1", 37.5, 127.0)]));
    naverMock.mockResolvedValue({
      provider: "naver-local",
      query: "q",
      places: [place("n-far", 38.0, 128.0), place("n-near", 37.5, 127.001)],
    });
  });

  it("리뷰순은 병합을 우회해 네이버만 부른다(카카오 미호출)", async () => {
    const res = await searchPlaces({ query: "길동 맛집", sort: "review" });
    expect(kakaoMock).not.toHaveBeenCalled();
    expect(naverMock).toHaveBeenCalledWith(expect.objectContaining({ sort: "review" }));
    expect(res.provider).toBe("naver-local");
    expect(res.places.map((p) => p.id)).toEqual(["n-far", "n-near"]);
  });

  it("좌표가 있어도 거리 재정렬 없이 표기만 붙는다", async () => {
    const res = await searchPlaces({ query: "길동 맛집", sort: "review", lat: 37.5, lng: 127.0 });
    expect(res.places.map((p) => p.id)).toEqual(["n-far", "n-near"]);
    expect(res.places[0].distanceMeters).toBeGreaterThan(res.places[1].distanceMeters!);
  });

  it("네이버 키가 없으면 조용한 폴백 없이 throw", async () => {
    hasNaver.mockReturnValue(false);
    await expect(searchPlaces({ query: "길동 맛집", sort: "review" })).rejects.toThrow(/네이버/);
    expect(kakaoMock).not.toHaveBeenCalled();
    expect(naverMock).not.toHaveBeenCalled();
  });

  it("sort 미지정·accuracy는 리뷰순 분기에 들어가지 않는다(카카오 경로)", async () => {
    hasNaver.mockReturnValue(false);
    await searchPlaces({ query: "q", sort: "accuracy" });
    await searchPlaces({ query: "q" });
    expect(kakaoMock).toHaveBeenCalledTimes(2);
    expect(naverMock).not.toHaveBeenCalled();
  });
});
