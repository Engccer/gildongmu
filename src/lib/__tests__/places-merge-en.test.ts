import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchPlacesMergedEn } from "../providers/places";
import { searchPlacesKakaoLocal } from "../providers/kakao-local";
import { searchPlacesTourApi } from "../providers/tour-api";
import type { Place, PlaceSearchResult } from "../types";

vi.mock("../providers/kakao-local");
vi.mock("../providers/tour-api");

const kakaoMock = vi.mocked(searchPlacesKakaoLocal);
const tourMock = vi.mocked(searchPlacesTourApi);

function result(provider: PlaceSearchResult["provider"], places: Place[]): PlaceSearchResult {
  return { provider, places, query: "q" };
}
function place(id: string, lat: number, lng: number): Place {
  return { id, name: id, category: "", address: "", roadAddress: "", lat, lng };
}

describe("searchPlacesMergedEn (en 병합 + 부분 실패)", () => {
  beforeEach(() => {
    kakaoMock.mockReset();
    tourMock.mockReset();
  });

  it("둘 다 성공하면 병합하고 provider를 merged로 표시한다", async () => {
    kakaoMock.mockResolvedValue(result("kakao-local", [place("kakao-1", 37.5, 127.0)]));
    tourMock.mockResolvedValue(result("tour-api", [place("tour-1", 37.6, 127.1)]));

    const res = await searchPlacesMergedEn({ query: "q", lang: "en" });

    expect(res.provider).toBe("merged");
    expect(res.places.map((p) => p.id)).toEqual(["kakao-1", "tour-1"]);
  });

  it("TourAPI가 실패해도 카카오 실데이터는 보존한다 (조용한 빈 결과 금지)", async () => {
    kakaoMock.mockResolvedValue(result("kakao-local", [place("kakao-1", 37.5, 127.0)]));
    tourMock.mockRejectedValue(new Error("TourAPI 401"));

    const res = await searchPlacesMergedEn({ query: "q", lang: "en" });

    expect(res.places.map((p) => p.id)).toEqual(["kakao-1"]);
  });

  it("둘 다 실패하면 빈 결과 대신 에러를 던진다", async () => {
    kakaoMock.mockRejectedValue(new Error("카카오 다운"));
    tourMock.mockRejectedValue(new Error("TourAPI 다운"));

    await expect(searchPlacesMergedEn({ query: "q", lang: "en" })).rejects.toThrow();
  });
});
