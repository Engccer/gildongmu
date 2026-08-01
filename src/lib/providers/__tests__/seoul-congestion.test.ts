import { describe, expect, it } from "vitest";
import { parseCongestion } from "../seoul-congestion";

const OK = {
  "SeoulRtd.citydata_ppltn": [
    {
      AREA_NM: "강남역",
      AREA_CD: "POI014",
      AREA_CONGEST_LVL: "붐빔",
      AREA_CONGEST_MSG:
        "사람들이 몰려있을 가능성이 매우 크고 많이 붐빈다고 느낄 수 있어요.",
      AREA_PPLTN_MIN: "76000",
      AREA_PPLTN_MAX: "78000",
      PPLTN_TIME: "2026-08-01 13:40",
      FCST_YN: "Y",
      FCST_PPLTN: [
        { FCST_TIME: "2026-08-01 15:00", FCST_CONGEST_LVL: "약간 붐빔" },
        { FCST_TIME: "2026-08-01 16:00", FCST_CONGEST_LVL: "보통" },
      ],
    },
  ],
};

describe("parseCongestion — 봉투", () => {
  it("정상 응답에서 등급어·문장·기준시각을 읽는다", () => {
    const r = parseCongestion(OK);
    expect(r).toEqual({
      level: "붐빔",
      message: "사람들이 몰려있을 가능성이 매우 크고 많이 붐빈다고 느낄 수 있어요.",
      asOf: "2026-08-01 13:40",
      forecast: [
        { time: "2026-08-01 15:00", level: "약간 붐빔" },
        { time: "2026-08-01 16:00", level: "보통" },
      ],
    });
  });

  it("인구수는 읽지 않는다(해석 불가 수치 — 등급어가 정본)", () => {
    expect(JSON.stringify(parseCongestion(OK))).not.toContain("76000");
  });

  it("등급어가 4단계 밖이어도 원문을 통과시킨다(열거형으로 좁히지 않는다)", () => {
    const odd = structuredClone(OK);
    odd["SeoulRtd.citydata_ppltn"][0].AREA_CONGEST_LVL = "매우 붐빔";
    expect(parseCongestion(odd)?.level).toBe("매우 붐빔");
  });

  it("FCST_YN이 N이면 예보는 빈 배열", () => {
    const noFcst = structuredClone(OK);
    noFcst["SeoulRtd.citydata_ppltn"][0].FCST_YN = "N";
    delete (noFcst["SeoulRtd.citydata_ppltn"][0] as Record<string, unknown>).FCST_PPLTN;
    expect(parseCongestion(noFcst)?.forecast).toEqual([]);
  });

  it("빈 배열은 null(영역은 있으나 데이터 없음)", () => {
    expect(parseCongestion({ "SeoulRtd.citydata_ppltn": [] })).toBeNull();
  });

  it("등급어가 비어 있으면 null(이름 없는 상태를 만들지 않는다)", () => {
    const blank = structuredClone(OK);
    blank["SeoulRtd.citydata_ppltn"][0].AREA_CONGEST_LVL = "";
    expect(parseCongestion(blank)).toBeNull();
  });

  it("평면 키 오류 봉투는 throw — 조회 실패와 영역 없음을 뭉개지 않는다", () => {
    expect(() =>
      parseCongestion({ "RESULT.CODE": "ERROR-500", "RESULT.MESSAGE": "서버 오류입니다." }),
    ).toThrow(/ERROR-500/);
  });

  it("배열이 아닌 응답은 throw(구조 변경을 침묵으로 넘기지 않는다)", () => {
    expect(() => parseCongestion({})).toThrow();
    expect(() => parseCongestion({ "SeoulRtd.citydata_ppltn": { AREA_NM: "x" } })).toThrow();
  });
});
