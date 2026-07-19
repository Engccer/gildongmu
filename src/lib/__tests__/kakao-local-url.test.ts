import { describe, it, expect } from "vitest";
import { buildKakaoSearchUrl } from "../providers/kakao-local";

describe("buildKakaoSearchUrl", () => {
  it("좌표가 없으면 query·size만, 좌표 파라미터는 없다", () => {
    const url = buildKakaoSearchUrl({ query: "맥도날드" });
    expect(url.searchParams.get("query")).toBe("맥도날드");
    // limit 미지정 시 provider 기본 10(라우트 zod가 실사용 경로에선 15로 덮음).
    expect(url.searchParams.get("size")).toBe("10");
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("y")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
  });

  it("좌표가 있으면 x(경도)·y(위도)를 붙이되 sort·radius는 지정하지 않는다(정확도순+블렌딩)", () => {
    const url = buildKakaoSearchUrl({
      query: "맥도날드",
      lat: 37.5384,
      lng: 127.1377,
    });
    expect(url.searchParams.get("x")).toBe("127.1377");
    expect(url.searchParams.get("y")).toBe("37.5384");
    expect(url.searchParams.get("sort")).toBeNull();
    expect(url.searchParams.get("radius")).toBeNull();
  });

  it("limit은 15로 클램프된다", () => {
    expect(
      buildKakaoSearchUrl({ query: "x", limit: 99 }).searchParams.get("size"),
    ).toBe("15");
  });

  it("lat만 있고 lng가 없으면 좌표 파라미터를 붙이지 않는다", () => {
    const url = buildKakaoSearchUrl({ query: "x", lat: 37.5 });
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("y")).toBeNull();
    expect(url.searchParams.get("sort")).toBeNull();
  });
});
