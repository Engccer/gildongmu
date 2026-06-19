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
  const base = { loading: false, placeCount: null, addrCount: null, spokenQuery: null };
  it("idle(둘 다 null, 비로딩)이면 null", () => {
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
});
