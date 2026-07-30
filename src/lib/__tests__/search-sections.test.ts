import { describe, it, expect } from "vitest";
import {
  orderResultSections,
  combinedLiveMessage,
  shouldFallbackToWeb,
} from "../search-sections";

describe("orderResultSections", () => {
  it("장소만 있으면 place만", () => {
    expect(orderResultSections(5, 0)).toEqual(["place"]);
  });
  it("주소만 있으면 address만", () => {
    expect(orderResultSections(0, 3)).toEqual(["address"]);
  });
  it("둘 다 있으면 건수 많은 쪽 위", () => {
    expect(orderResultSections(2, 5)).toEqual(["address", "place"]);
    expect(orderResultSections(7, 1)).toEqual(["place", "address"]);
  });
  it("동률이면 장소 우선", () => {
    expect(orderResultSections(3, 3)).toEqual(["place", "address"]);
  });
  it("둘 다 0이면 빈 배열", () => {
    expect(orderResultSections(0, 0)).toEqual([]);
  });
});

describe("combinedLiveMessage 공존 모델", () => {
  const base = { loading: false, spokenQuery: null, placeErrored: false };

  it("장소·웹·주소 모두 있으면 세 part를 순서대로", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 12, webCount: 5, addrCount: 2 }),
    ).toEqual([
      { key: "search.placeCount", values: { count: 12 } },
      { key: "search.webCount", values: { count: 5 } },
      { key: "search.addressCount", values: { count: 2 } },
    ]);
  });

  it("장소만 있으면 placeCount 단일 part", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 8, webCount: 0, addrCount: 0 }),
    ).toEqual([{ key: "search.placeCount", values: { count: 8 } }]);
  });

  it("웹만 있으면 webCount 단일 part(장소 0건이어도 noResults 아님)", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 0, webCount: 3, addrCount: 0 }),
    ).toEqual([{ key: "search.webCount", values: { count: 3 } }]);
  });

  it("loading이면 searching", () => {
    expect(
      combinedLiveMessage({ ...base, loading: true, placeCount: null, webCount: null, addrCount: null }),
    ).toEqual([{ key: "search.searching" }]);
  });

  it("loading + spokenQuery면 searchingFor", () => {
    expect(
      combinedLiveMessage({ ...base, loading: true, spokenQuery: "길동 카페", placeCount: null, webCount: null, addrCount: null }),
    ).toEqual([{ key: "search.searchingFor" }]);
  });

  it("검색 전 idle(모두 null·비에러)이면 null", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, webCount: null, addrCount: null }),
    ).toBeNull();
  });

  it("모두 0건 + 장소 에러면 search.error", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, webCount: 0, addrCount: 0, placeErrored: true }),
    ).toEqual([{ key: "search.error" }]);
  });

  it("모두 0건 + 에러 아님이면 noResults", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: 0, webCount: 0, addrCount: 0 }),
    ).toEqual([{ key: "search.noResults" }]);
  });

  it("장소 에러여도 웹 결과가 있으면 웹만 통지(에러 억제 — 웹은 보조)", () => {
    expect(
      combinedLiveMessage({ ...base, placeCount: null, webCount: 5, addrCount: 0, placeErrored: true }),
    ).toEqual([{ key: "search.webCount", values: { count: 5 } }]);
  });

  it("주소 조회 실패는 '결과 없음'과 구분해 통지한다", () => {
    expect(
      combinedLiveMessage({
        loading: false, placeCount: 0, addrCount: null, webCount: null,
        spokenQuery: null, placeErrored: false, addrErrored: true,
      }),
    ).toEqual([{ key: "search.addressError" }]);
  });
  it("장소 결과가 있어도 주소 실패는 뒤에 덧붙인다", () => {
    expect(
      combinedLiveMessage({
        loading: false, placeCount: 3, addrCount: null, webCount: null,
        spokenQuery: null, placeErrored: false, addrErrored: true,
      }),
    ).toEqual([
      { key: "search.placeCount", values: { count: 3 } },
      { key: "search.addressError" },
    ]);
  });
  it("장소 에러가 주소 에러보다 우선한다", () => {
    expect(
      combinedLiveMessage({
        loading: false, placeCount: null, addrCount: null, webCount: null,
        spokenQuery: null, placeErrored: true, addrErrored: true,
      }),
    ).toEqual([{ key: "search.error" }]);
  });
});

describe("orderResultSections — 웹", () => {
  it("웹만 있으면 web 단독", () => {
    expect(orderResultSections(0, 0, 3)).toEqual(["web"]);
  });
  it("웹+주소면 건수 내림차순(웹>주소)", () => {
    expect(orderResultSections(0, 2, 5)).toEqual(["web", "address"]);
    expect(orderResultSections(0, 5, 2)).toEqual(["address", "web"]);
  });
  it("place만이면 기존대로(web 0)", () => {
    expect(orderResultSections(3, 0, 0)).toEqual(["place"]);
  });
  it("동률 웹·주소면 web 우선(rank)", () => {
    expect(orderResultSections(0, 3, 3)).toEqual(["web", "address"]);
  });
});

describe("orderResultSections 공존", () => {
  it("place·web 동시에 건수 내림차순", () => {
    expect(orderResultSections(3, 0, 5)).toEqual(["web", "place"]);
    expect(orderResultSections(10, 0, 5)).toEqual(["place", "web"]);
  });
  it("셋 동시 — 건수 내림차순, 동률 place>web>address", () => {
    expect(orderResultSections(4, 4, 4)).toEqual(["place", "web", "address"]);
  });
});

describe("shouldFallbackToWeb", () => {
  // 0건 폴백 — 카카오·juso 둘 다 0건(구조화된 국내 데이터로 못 찾음)일 때만 웹.
  it("장소·주소 둘 다 0건이면 폴백(웹 호출)", () => {
    expect(shouldFallbackToWeb(0, 0)).toBe(true);
  });
  it("장소가 1건이라도 있으면 폴백 안 함", () => {
    expect(shouldFallbackToWeb(1, 0)).toBe(false);
    expect(shouldFallbackToWeb(15, 0)).toBe(false);
  });
  it("주소가 1건이라도 있으면 폴백 안 함('세종대로 110'은 주소로 찾음)", () => {
    expect(shouldFallbackToWeb(0, 2)).toBe(false);
  });
  it("둘 다 있으면 폴백 안 함", () => {
    expect(shouldFallbackToWeb(5, 3)).toBe(false);
  });
});
