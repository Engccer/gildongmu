import { describe, it, expect } from "vitest";
import { pickTimetableStation, subwayHoursKey } from "../providers/subway-service-hours";

/**
 * 후보 배열은 전부 TAGO GetKwrdFndSubwaySttnList 실응답을 그대로 옮긴 값이다
 * (실호출 2026-08-01). 조인 규칙은 양쪽 표기 차이가 전부라, 손으로 지어낸
 * 후보로 테스트하면 스스로 만든 세계만 검증하게 된다.
 */

/** 키워드 "부평" — 수도권 1호선(경인선, MTRKR 계열)과 인천1호선이 공존한다. */
const BUPYEONG = [
  { id: "MTRIC7759", name: "부평구청", routeName: "7호선" },
  { id: "MTRICI1118", name: "부평구청", routeName: "인천1호선" },
  { id: "MTRICI1119", name: "부평시장", routeName: "인천1호선" },
  { id: "MTRICI1120", name: "부평", routeName: "인천1호선" },
  { id: "MTRICI1122", name: "부평삼거리", routeName: "인천1호선" },
  { id: "MTRKR1152", name: "부평", routeName: "1호선" },
];

/** 키워드 "서울" — 서울역 5개 노선 + 이름이 "서울"로 시작할 뿐인 역들이 섞여 온다. */
const SEOUL = [
  { id: "MTRARA1A01", name: "서울역", routeName: "공항" },
  { id: "MTRGXAX106", name: "서울역", routeName: "GTX-A" },
  { id: "MTRKRK1K211", name: "서울숲", routeName: "수인분당" },
  { id: "MTRKRK4P313", name: "서울역", routeName: "경의중앙" },
  { id: "MTRS11150", name: "서울역", routeName: "1호선" },
  { id: "MTRS12228", name: "서울대입구(관악구청)", routeName: "2호선" },
  { id: "MTRS14426", name: "서울역", routeName: "4호선" },
];

describe("pickTimetableStation", () => {
  it("지역이 붙은 TAGO 노선명을 1단계에서 고른다 (인천)", () => {
    expect(pickTimetableStation(BUPYEONG, "부평", "인천 1호선")?.id).toBe("MTRICI1120");
  });

  it("지역을 뗀 TAGO 노선명은 2단계 폴백에서 고른다 (수도권)", () => {
    // 1단계 코어 "수도권1"은 0건 → 2단계 "1호선". 숫자 완전 일치 규칙이
    // "1"과 "인천1"을 갈라 주지 않으면 여기서 모호(null)로 떨어진다.
    expect(pickTimetableStation(BUPYEONG, "부평", "수도권 1호선")?.id).toBe("MTRKR1152");
  });

  it("비수도권도 같은 폴백으로 붙는다 (부산)", () => {
    const seomyeon = [
      { id: "MTRBS1119", name: "서면", routeName: "1호선" },
      { id: "MTRBS2219", name: "서면", routeName: "2호선" },
    ];
    expect(pickTimetableStation(seomyeon, "서면", "부산 2호선")?.id).toBe("MTRBS2219");
  });

  it("구분자 표기가 달라도 붙는다 (수인.분당선 ↔ 수인분당)", () => {
    const wangsimni = [
      { id: "MTRKRK1K210", name: "왕십리", routeName: "수인분당" },
      { id: "MTRKRK4K210", name: "왕십리", routeName: "경의중앙" },
      { id: "MTRS12207", name: "상왕십리", routeName: "2호선" },
      { id: "MTRS12208", name: "왕십리", routeName: "2호선" },
      { id: "MTRS152541", name: "왕십리", routeName: "5호선" },
    ];
    expect(pickTimetableStation(wangsimni, "왕십리", "수도권 수인.분당선")?.id).toBe(
      "MTRKRK1K210",
    );
    expect(pickTimetableStation(wangsimni, "왕십리", "수도권 2호선")?.id).toBe("MTRS12208");
  });

  it("역명은 정규화 후 완전 일치만 인정한다 (포함 검색 노이즈 배제)", () => {
    // 부분 일치를 쓰면 서울대입구·서울숲을 집는다. "서울역"은 접미 "역"이
    // 정규화로 떨어져 "서울"이 되고, 후보 쪽 "서울역"도 같은 키가 된다.
    expect(pickTimetableStation(SEOUL, "서울역", "수도권 1호선")?.id).toBe("MTRS11150");
    expect(pickTimetableStation(SEOUL, "서울역", "수도권 4호선")?.id).toBe("MTRS14426");
  });

  it("접미가 '선'이 아닌 축약 노선명도 붙는다 (공항철도 ↔ 공항)", () => {
    expect(pickTimetableStation(SEOUL, "서울역", "수도권 공항철도")?.id).toBe("MTRARA1A01");
  });

  it("교차 도시 동명이역이 같은 노선번호면 판정하지 않는다", () => {
    // "시청" 1호선은 서울·부산·대전 셋이다. 괄호를 떼면 이름도 노선명도 같고
    // TAGO 응답엔 도시 필드가 없어 가를 수단이 없다. 틀린 답 대신 null.
    const cityHall = [
      { id: "MTRBS1122", name: "시청(연제)", routeName: "1호선" },
      { id: "MTRDJ10011", name: "시청", routeName: "1호선" },
      { id: "MTRS11151", name: "시청", routeName: "1호선" },
      { id: "MTRS12201", name: "시청", routeName: "2호선" },
    ];
    expect(pickTimetableStation(cityHall, "시청", "대전 1호선")).toBeNull();
    // 충돌하지 않는 노선은 같은 후보 집합에서도 정상 판정된다.
    expect(pickTimetableStation(cityHall, "시청", "수도권 2호선")?.id).toBe("MTRS12201");
  });

  it("이름이 안 맞으면 null (미커버)", () => {
    expect(pickTimetableStation(BUPYEONG, "길동", "수도권 5호선")).toBeNull();
    expect(pickTimetableStation([], "부평", "수도권 1호선")).toBeNull();
  });

  it("노선명이 비면 null (조인 축 결측)", () => {
    expect(pickTimetableStation(BUPYEONG, "부평", "")).toBeNull();
  });
});

describe("subwayHoursKey", () => {
  const base = { stationName: "길동", lineName: "수도권 5호선", wayCode: 1 };

  it("같은 구간은 같은 키 — 역명 장식 차이를 흡수한다", () => {
    expect(subwayHoursKey(base)).toBe(subwayHoursKey({ ...base, stationName: "길동역" }));
  });

  it("방향이 다르면 다른 키 — 상·하행 첫차·막차가 다르다", () => {
    expect(subwayHoursKey(base)).not.toBe(subwayHoursKey({ ...base, wayCode: 2 }));
  });

  it("노선이 다르면 다른 키", () => {
    expect(subwayHoursKey(base)).not.toBe(subwayHoursKey({ ...base, lineName: "수도권 8호선" }));
  });
});
