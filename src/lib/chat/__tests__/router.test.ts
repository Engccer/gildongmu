/**
 * executeFunction 라우터 테스트.
 * searchPlaces의 실제 시그니처: searchPlaces(params: PlaceSearchParams): Promise<PlaceSearchResult>
 * PlaceSearchResult = { places: Place[], provider, query }
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/providers/places", () => ({
  searchPlaces: vi.fn(async ({ lang }: { lang: string }) => ({
    places: [
      {
        id: "1",
        name: lang === "en" ? "Gildong Cafe" : "길동 카페",
        category: lang === "en" ? "cafe" : "카페",
        address: lang === "en" ? "Gangdong" : "강동구",
        roadAddress: "",
        lat: 37.5,
        lng: 127.1,
      },
    ],
    provider: "kakao-local",
    query: "q",
  })),
}));

vi.mock("@/lib/providers/juso-address", () => ({
  searchJusoAddresses: vi.fn(async (_keyword: string) => [
    {
      roadAddr: "서울특별시 중구 세종대로 110 (태평로1가)",
      roadAddrPart1: "서울특별시 중구 세종대로 110",
      jibunAddr: "서울특별시 중구 태평로1가 31",
      engAddr: "110 Sejong-daero, Jung-gu, Seoul",
      zipNo: "04524",
      bdNm: "서울특별시청",
    },
  ]),
}));

import { executeFunction } from "../router";

const ctxKo = { locale: "ko", dataLocale: "ko" as const };

describe("executeFunction search_places", () => {
  it("ko → searchPlaces({ query, lang:'ko' }) 호출 + places render + summary 포함", async () => {
    const r = await executeFunction("search_places", { query: "카페" }, ctxKo);
    expect(r.render).toEqual({
      type: "places",
      places: [expect.objectContaining({ name: "길동 카페" })],
    });
    expect(r.summary).toContain("길동 카페");

    const { searchPlaces } = await import("@/lib/providers/places");
    expect(searchPlaces).toHaveBeenCalledWith({ query: "카페", lang: "ko" });
  });

  it("en(dataLocale:'en') → lang:'en' 으로 호출 + 영문 장소명 반환", async () => {
    const r = await executeFunction("search_places", { query: "cafe" }, {
      locale: "en",
      dataLocale: "en",
    });
    expect((r.render as { type: string; places: { name: string }[] }).places[0].name).toBe(
      "Gildong Cafe",
    );

    const { searchPlaces } = await import("@/lib/providers/places");
    expect(searchPlaces).toHaveBeenCalledWith({ query: "cafe", lang: "en" });
  });

  it("알 수 없는 도구 이름 → Error throw", async () => {
    await expect(executeFunction("nope", {}, ctxKo)).rejects.toThrow("알 수 없는 도구");
  });
});

describe("executeFunction search_address", () => {
  it("keyword → searchJusoAddresses 호출 + addresses render + summary 포함", async () => {
    const r = await executeFunction("search_address", { keyword: "세종대로 110" }, ctxKo);
    expect(r.render).toEqual({
      type: "addresses",
      results: [expect.objectContaining({ roadAddrPart1: "서울특별시 중구 세종대로 110" })],
    });
    expect(r.summary).toContain("세종대로 110");

    const { searchJusoAddresses } = await import("@/lib/providers/juso-address");
    expect(searchJusoAddresses).toHaveBeenCalledWith("세종대로 110");
  });

  it("keyword 누락 시 빈 문자열로 호출", async () => {
    await executeFunction("search_address", {}, ctxKo);
    const { searchJusoAddresses } = await import("@/lib/providers/juso-address");
    expect(searchJusoAddresses).toHaveBeenCalledWith("");
  });
});
