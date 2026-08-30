import { describe, expect, it } from "vitest";
import seed from "../data/subway-stations.json";
import observed from "./fixtures/odsay-lane-names-observed.json";
import { subwayLineKey, subwayLineNameEn, subwayLineNamesEn } from "../subway-line-names";
import { subwayLineNameForId } from "../providers/seoul-subway-arrival";
import { displayLineName } from "../providers/tago-subway";

/**
 * 노선명 영문 표 drift 가드(E27 §3.3) — 표에 넣는 최종 입력을 **실제 생산자가 넘기는 값**으로
 * 모은다(설계 리뷰 #10: 상수만 보면 중간 변환이 만든 값을 놓친다). 다섯 축:
 *  ① seed `lineName` 고유값 전수(연 1회 갱신 시 새 노선이 여기서 드러난다)
 *  ② 서울 실시간 subwayId 표(`SUBWAY_LINES`) 값 전수
 *  ③ ODsay 실시간 매핑표(`ODSAY_SUBWAY_LINES`) 키 전수
 *  ④ ODsay `lang=1` 실관측 lane `nameKor`(fixture, `(급행)` 포함)
 *  ⑤ TAGO `routeName` 관측값과 `displayLineName` 통과값
 */

const SEOUL_SUBWAY_IDS = [
  "1001", "1002", "1003", "1004", "1005", "1006", "1007", "1008", "1009", "1032", "1061",
  "1063", "1065", "1067", "1075", "1077", "1081", "1092", "1093", "1094",
];
const ODSAY_KEYS = [
  "1호선", "2호선", "3호선", "4호선", "5호선", "6호선", "7호선", "8호선", "9호선", "GTX-A", "중앙선",
  "경의중앙선", "공항철도", "경춘선", "수인분당선", "신분당선", "경강선", "우이신설선", "서해선", "신림선",
];
/** TAGO SubwayInfo `routeName` 관측값(subway-service-hours 테스트·실호출 2026-08-01·08-23) */
const TAGO_ROUTE_NAMES = [
  "1호선", "2호선", "7호선", "인천1호선", "공항", "GTX-A", "수인분당", "경의중앙", "신분당", "9호선",
];

function expectAllMapped(label: string, inputs: string[]) {
  const missing = inputs.filter((v) => subwayLineNameEn(v) === null);
  expect(missing, `${label} 미지 노선명`).toEqual([]);
}

describe("subwayLineNameEn — 생산자 5축 전수 매핑", () => {
  it("① seed lineName 고유값 전수", () => {
    const unique = [...new Set((seed as Array<{ lineName: string }>).map((s) => s.lineName))];
    expect(unique.length).toBeGreaterThan(40);
    expectAllMapped("seed", unique);
  });
  it("② 서울 실시간 subwayId 표 값 전수", () => {
    const names = SEOUL_SUBWAY_IDS.map((id) => subwayLineNameForId(id)).filter((v): v is string => !!v);
    expect(names.length).toBe(SEOUL_SUBWAY_IDS.length);
    expectAllMapped("SUBWAY_LINES", names);
  });
  it("③ ODsay 실시간 매핑표 키 전수", () => expectAllMapped("ODSAY_SUBWAY_LINES", ODSAY_KEYS));
  it("④ ODsay lang=1 실관측 nameKor 전수(급행 포함)", () => {
    expectAllMapped("odsay nameKor", observed.lanes.map((l) => l.nameKor));
    expect(subwayLineNameEn("수도권 9호선(급행)")).toBe("Line 9 Express");
    expect(subwayLineNameEn("수도권 수인.분당선")).toBe("Suin-Bundang Line");
    expect(subwayLineNameEn("부산 1호선")).toBe("Busan Line 1");
  });
  it("⑤ TAGO routeName 원문과 displayLineName 통과값 전수", () => {
    expectAllMapped("TAGO raw", TAGO_ROUTE_NAMES);
    expectAllMapped("TAGO displayLineName", TAGO_ROUTE_NAMES.map(displayLineName));
  });
});

describe("subwayLineNameEn — 정책", () => {
  it("미지 입력은 null(음차·폴백 없음)", () => {
    expect(subwayLineNameEn("화성선")).toBeNull();
    expect(subwayLineNameEn("")).toBeNull();
    expect(subwayLineNameEn(undefined)).toBeNull();
  });
  it("표기에 en dash·가운뎃점이 없다(낭독 미확인 기호 금지)", () => {
    const seen = new Set<string>();
    for (const s of seed as Array<{ lineName: string }>) {
      const en = subwayLineNameEn(s.lineName);
      if (en) seen.add(en);
    }
    for (const en of seen) expect(en).not.toMatch(/[–·ㆍ]/);
  });
  it("키 정규화 — 공백·마침표·수도권 접두를 벗기고 급행을 분리한다", () => {
    expect(subwayLineKey("수도권  도시철도 9호선")).toEqual({ key: "도시철도9호선", express: false });
    expect(subwayLineKey("수도권 9호선(급행)")).toEqual({ key: "9호선", express: true });
    expect(subwayLineKey("부산 도시철도 1호선")).toEqual({ key: "부산도시철도1호선", express: false });
  });
  it("배열형은 하나라도 미지면 전체 부재", () => {
    expect(subwayLineNamesEn(["2호선", "신분당선"])).toEqual(["Line 2", "Shinbundang Line"]);
    expect(subwayLineNamesEn(["2호선", "화성선"])).toBeUndefined();
    expect(subwayLineNamesEn([])).toEqual([]);
  });
});
