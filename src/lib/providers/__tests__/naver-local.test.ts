import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../env", () => ({
  env: { NAVER_LOCAL_CLIENT_ID: "id", NAVER_LOCAL_CLIENT_SECRET: "secret" },
}));

const item = {
  title: "<b>진주집</b>",
  link: "",
  category: "음식점",
  description: "",
  telephone: "",
  address: "서울 영등포구",
  roadAddress: "서울 영등포구 국제금융로",
  mapx: "1269250000",
  mapy: "375250000",
};

describe("searchPlacesNaverLocal — sort 파라미터·오류 봉투(spec 2026-08-17 §1·§3.2)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  function ok(body: unknown) {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
  }
  function calledUrl(): URL {
    return new URL(String(fetchMock.mock.calls[0][0]));
  }

  it("sort=review면 네이버 sort=comment·display=5(limit 무시)", async () => {
    ok({ total: 1, start: 1, display: 1, items: [item] });
    const { searchPlacesNaverLocal } = await import("../naver-local");
    const res = await searchPlacesNaverLocal({ query: "여의도 맛집", sort: "review", limit: 15 });
    expect(calledUrl().searchParams.get("sort")).toBe("comment");
    expect(calledUrl().searchParams.get("display")).toBe("5");
    expect(res.places[0].name).toBe("진주집");
  });

  it("sort 미지정이면 sort 파라미터를 붙이지 않는다(기존 요청과 바이트 동일)", async () => {
    ok({ total: 1, start: 1, display: 1, items: [item] });
    const { searchPlacesNaverLocal } = await import("../naver-local");
    await searchPlacesNaverLocal({ query: "여의도 맛집" });
    expect(calledUrl().searchParams.has("sort")).toBe(false);
    expect(calledUrl().searchParams.get("display")).toBe("5");
  });

  it("200에 errorCode가 실려 오면 throw(조용한 빈 결과·TypeError 금지)", async () => {
    ok({ errorCode: "SE04", errorMessage: "부적절한 sort값입니다." });
    const { searchPlacesNaverLocal } = await import("../naver-local");
    await expect(searchPlacesNaverLocal({ query: "q", sort: "review" })).rejects.toThrow(/SE04/);
  });
});
