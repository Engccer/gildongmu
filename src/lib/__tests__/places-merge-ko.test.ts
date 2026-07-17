import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPlacesMergedKo } from "../providers/places";
import { searchPlacesKakaoLocal } from "../providers/kakao-local";
import { searchPlacesNaverLocal } from "../providers/naver-local";
import type { Place, PlaceSearchResult } from "../types";

vi.mock("../providers/kakao-local");
vi.mock("../providers/naver-local");

const kakaoMock = vi.mocked(searchPlacesKakaoLocal);
const naverMock = vi.mocked(searchPlacesNaverLocal);

function result(provider: PlaceSearchResult["provider"], places: Place[]): PlaceSearchResult {
  return { provider, places, query: "q" };
}
function place(id: string, lat: number, lng: number): Place {
  return { id, name: id, category: "", address: "", roadAddress: "", lat, lng };
}

describe("searchPlacesMergedKo (ko 카카오+네이버 병합)", () => {
  beforeEach(() => {
    kakaoMock.mockReset();
    naverMock.mockReset();
  });

  it("둘 다 성공하면 병합하고 provider를 merged로 표시한다", async () => {
    kakaoMock.mockResolvedValue(result("kakao-local", [place("kakao-1", 37.5, 127.0)]));
    naverMock.mockResolvedValue(result("naver-local", [place("naver-1", 37.6, 127.1)]));

    const res = await searchPlacesMergedKo({ query: "q" });

    expect(res.provider).toBe("merged");
    expect(res.places.map((p) => p.id)).toEqual(["kakao-1", "naver-1"]);
  });

  it("좌표가 있으면 병합 결과를 거리순으로 재정렬한다 — 카카오 원거리 결과보다 근처 네이버 전용 가게가 앞에 온다", async () => {
    // 백년찌개 시나리오: 카카오는 원거리 유사명만, 네이버에만 근처 실가게가 있다
    kakaoMock.mockResolvedValue(
      result("kakao-local", [
        place("kakao-부천-백년전골", 37.5045, 126.763),
        place("kakao-용인-백년집", 37.33, 127.19),
      ]),
    );
    naverMock.mockResolvedValue(
      result("naver-local", [place("naver-여의도-백년찌개집", 37.5285, 126.9195)]),
    );

    const res = await searchPlacesMergedKo({ query: "백년찌개", lat: 37.5319, lng: 126.914 });

    expect(res.places[0].id).toBe("naver-여의도-백년찌개집");
    expect(res.places[0].distanceMeters).toBeLessThan(1000);
  });

  it("좌표 4자리가 겹치는 네이버 중복은 제거하고 카카오를 우선한다", async () => {
    kakaoMock.mockResolvedValue(result("kakao-local", [place("kakao-1", 37.50001, 127.00001)]));
    naverMock.mockResolvedValue(
      result("naver-local", [place("naver-dup", 37.50003, 127.00003), place("naver-2", 37.6, 127.1)]),
    );

    const res = await searchPlacesMergedKo({ query: "q" });

    expect(res.places.map((p) => p.id)).toEqual(["kakao-1", "naver-2"]);
  });

  it("네이버가 실패해도 카카오 실데이터는 보존한다 (조용한 빈 결과 금지)", async () => {
    kakaoMock.mockResolvedValue(result("kakao-local", [place("kakao-1", 37.5, 127.0)]));
    naverMock.mockRejectedValue(new Error("네이버 429"));

    const res = await searchPlacesMergedKo({ query: "q" });

    expect(res.places.map((p) => p.id)).toEqual(["kakao-1"]);
  });

  it("카카오가 실패해도 네이버 실데이터는 보존한다", async () => {
    kakaoMock.mockRejectedValue(new Error("카카오 다운"));
    naverMock.mockResolvedValue(result("naver-local", [place("naver-1", 37.5, 127.0)]));

    const res = await searchPlacesMergedKo({ query: "q" });

    expect(res.places.map((p) => p.id)).toEqual(["naver-1"]);
  });

  it("둘 다 성공했지만 0건이면 에러가 아니라 빈 배열이다 (0건 ≠ 실패, 3-state)", async () => {
    kakaoMock.mockResolvedValue(result("kakao-local", []));
    naverMock.mockResolvedValue(result("naver-local", []));

    const res = await searchPlacesMergedKo({ query: "존재하지않는가게명" });

    expect(res.provider).toBe("merged");
    expect(res.places).toEqual([]);
  });

  it("둘 다 실패하면 빈 결과 대신 에러를 던진다", async () => {
    kakaoMock.mockRejectedValue(new Error("카카오 다운"));
    naverMock.mockRejectedValue(new Error("네이버 다운"));

    await expect(searchPlacesMergedKo({ query: "q" })).rejects.toThrow();
  });
});
