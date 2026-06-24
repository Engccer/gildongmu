import { describe, it, expect } from "vitest";
import { orderResultSections, combinedLiveMessage } from "../search-sections";

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

describe("combinedLiveMessage", () => {
  const base = {
    loading: false,
    placeCount: null,
    addrCount: null,
    spokenQuery: null,
    placeErrored: false, // 시그니처 변경 반영
  };
  it("idle(둘 다 null, 비로딩, 에러 아님)이면 null", () => {
    expect(combinedLiveMessage(base)).toBeNull();
  });
  it("로딩이면 searching", () => {
    expect(combinedLiveMessage({ ...base, loading: true })).toEqual({
      key: "search.searching",
    });
  });
  it("로딩 + 음성질의면 searchingFor", () => {
    expect(
      combinedLiveMessage({ ...base, loading: true, spokenQuery: "강남 맛집" }),
    ).toEqual({ key: "search.searchingFor" });
  });
  it("장소만 완료면 resultsAnnouncement", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 5, addrCount: 0 })).toEqual({
      key: "search.resultsAnnouncement",
      values: { count: 5 },
    });
  });
  it("주소만 완료면 addressResultsAnnouncement", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 0, addrCount: 3 })).toEqual({
      key: "search.addressResultsAnnouncement",
      values: { count: 3 },
    });
  });
  it("둘 다 완료면 combinedAnnouncement", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 2, addrCount: 4 })).toEqual({
      key: "search.combinedAnnouncement",
      values: { place: 2, addr: 4 },
    });
  });
  it("둘 다 0건 완료면 결과 0건", () => {
    expect(combinedLiveMessage({ ...base, placeCount: 0, addrCount: 0 })).toEqual({
      key: "search.resultsAnnouncement",
      values: { count: 0 },
    });
  });

  // --- I-1: 에러 케이스 ---
  it("장소 에러 + 결과 없음이면 search.error 통지(무음 회귀 방지)", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeErrored: true,
        placeCount: null,
        addrCount: null,
        loading: false,
      }),
    ).toEqual({ key: "search.error" });
  });
  it("장소 에러여도 주소 결과 있으면 주소 통지 우선", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeErrored: true,
        placeCount: null,
        addrCount: 3,
        loading: false,
      }),
    ).toEqual({ key: "search.addressResultsAnnouncement", values: { count: 3 } });
  });
  it("로딩 중엔 에러보다 searching 우선", () => {
    expect(
      combinedLiveMessage({ ...base, placeErrored: true, loading: true }),
    ).toEqual({ key: "search.searching" });
  });

  // --- 웹 라우팅(길 A/B) ---
  it("웹 폴백(장소 0건, 길 B)이면 webFallback 통지", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeCount: 0,
        addrCount: 0,
        webCount: 4,
        webFallback: true,
      }),
    ).toEqual({ key: "search.webFallbackAnnouncement", values: { count: 4 } });
  });
  it("웹 직접 라우팅(길 A)이면 webResults 통지", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeCount: null,
        addrCount: 0,
        webCount: 4,
        webFallback: false,
      }),
    ).toEqual({ key: "search.webResultsAnnouncement", values: { count: 4 } });
  });
  it("웹+주소 둘 다면 합산 통지", () => {
    expect(
      combinedLiveMessage({
        ...base,
        placeCount: null,
        addrCount: 2,
        webCount: 4,
        webFallback: false,
      }),
    ).toEqual({ key: "search.webAndAddressAnnouncement", values: { web: 4, addr: 2 } });
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
