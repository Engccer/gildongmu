import { describe, it, expect } from "vitest";
import fixture from "./fixtures/korail-facilities.json";
import {
  parseStationItems,
  parseStationFacilities,
} from "../providers/korail-facilities";

/**
 * 한국철도공사 편의시설 파서 테스트 — fixture는 2026-06-14 실응답.
 *
 * 실 API는 역명 필터를 지원하지 않아 전체(406역) 리스트를 받아
 * 정규화된 역명으로 클라이언트 매칭한다. 교통약자 정보가 두 엔드포인트
 * (weekPersonFacilities·stationFacilities)에 분산되므로 둘을 조인한다.
 */

const wpf = fixture.weekPersonFacilities;
const sf = fixture.stationFacilities;

describe("parseStationItems", () => {
  it("envelope에서 item 배열을 뽑는다", () => {
    const items = parseStationItems(wpf);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(3);
  });
  it("빈 결과(items 없음)는 빈 배열", () => {
    expect(parseStationItems({ response: { body: { items: "" } } })).toEqual([]);
    expect(parseStationItems(null)).toEqual([]);
    expect(parseStationItems({})).toEqual([]);
  });
  it("item이 단일 객체로 와도 배열로 정규화", () => {
    const single = {
      response: { body: { items: { item: { stn_nm: "서울", stn_cd: "1" } } } },
    };
    expect(parseStationItems(single).length).toBe(1);
  });
});

describe("parseStationFacilities", () => {
  it("서울역 — 두 엔드포인트 조인 후 정규화", () => {
    const result = parseStationFacilities(wpf, sf, "서울");
    expect(result).not.toBeNull();
    expect(result!.stationName).toBe("서울");
    expect(result!.accessibleToilet).toBe(true); // pwdbs_tolt_estnc=Y
    expect(result!.wheelchairLifts).toBe(1); // whlch_liftt_cnt=1
    expect(result!.accessibleSlope).toBe(true); // pwdbs_slwy_estnc=Y
    expect(result!.elevators).toBe(18); // stationFacilities elevt_cnt=18
  });

  it("행신역 — 리프트 0·엘리베이터 4", () => {
    const result = parseStationFacilities(wpf, sf, "행신");
    expect(result!.wheelchairLifts).toBe(0);
    expect(result!.elevators).toBe(4);
    expect(result!.accessibleToilet).toBe(true);
  });

  it("가야역 — 장애인 화장실 없음", () => {
    const result = parseStationFacilities(wpf, sf, "가야");
    expect(result!.accessibleToilet).toBe(false);
    expect(result!.accessibleSlope).toBe(false);
    expect(result!.elevators).toBe(0);
  });

  it("매칭 역 없으면 null(미커버 역 — graceful)", () => {
    expect(parseStationFacilities(wpf, sf, "강남")).toBeNull();
  });

  it("stationFacilities가 비어도 weekPerson만으로 부분 결과", () => {
    const emptySf = { response: { body: { items: "" } } };
    const result = parseStationFacilities(wpf, emptySf, "서울");
    expect(result).not.toBeNull();
    expect(result!.accessibleToilet).toBe(true);
    expect(result!.elevators).toBeUndefined();
  });

  it("교통약자(weekPerson)가 비면 null — 핵심 데이터 부재", () => {
    const emptyWpf = { response: { body: { items: "" } } };
    expect(parseStationFacilities(emptyWpf, sf, "서울")).toBeNull();
  });
});
