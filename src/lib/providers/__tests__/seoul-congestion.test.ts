import { describe, expect, it } from "vitest";
import { parseCongestion, readSeoulOpenJson } from "../seoul-congestion";

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

  it("FCST_YN이 N이면 배열이 남아 있어도 예보를 쓰지 않는다(플래그가 정본)", () => {
    // ⚠ FCST_PPLTN을 함께 지우면 안 된다 — 두 축을 동시에 바꾸면
    // FCST_YN 검사를 통째로 없애도 테스트가 통과한다(변이 F가 생존했던 이유).
    const flagged = structuredClone(OK);
    flagged["SeoulRtd.citydata_ppltn"][0].FCST_YN = "N";
    expect(flagged["SeoulRtd.citydata_ppltn"][0].FCST_PPLTN).toHaveLength(2);
    expect(parseCongestion(flagged)?.forecast).toEqual([]);
  });

  it("FCST_PPLTN 자체가 없어도 빈 배열(터지지 않는다)", () => {
    const noFcst = structuredClone(OK);
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

  it("정상 응답의 중첩 RESULT(INFO-000)는 오류가 아니다", () => {
    // 실측: 성공 응답에도 `RESULT: { "RESULT.CODE": "INFO-000" }`가 함께 온다.
    // 코드 존재만으로 오류 처리하면 **모든 정상 응답이 502가 된다.**
    const withResult = {
      ...structuredClone(OK),
      RESULT: { "RESULT.CODE": "INFO-000", "RESULT.MESSAGE": "정상 처리되었습니다." },
    };
    expect(parseCongestion(withResult)?.level).toBe("붐빔");
  });

  it("무효 키 XML 응답은 원인을 말하고 throw한다(HTTP 200 함정)", async () => {
    // 실측: 인증키가 무효하면 `/json/` 경로여도 200 + XML이 온다.
    // 그냥 res.json()을 부르면 "Unexpected token '<'"가 되어 원인이 가려진다.
    const xml =
      "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>";
    await expect(readSeoulOpenJson(new Response(xml), "citydata_ppltn")).rejects.toThrow(
      /INFO-100.*인증키/,
    );
  });

  it("코드를 못 읽는 비-JSON도 인증키를 먼저 의심하라고 말한다", async () => {
    await expect(readSeoulOpenJson(new Response("<html>502</html>"), "x")).rejects.toThrow(
      /인증키/,
    );
  });

  it("정상 JSON은 그대로 통과한다(앞 공백·배열 포함)", async () => {
    expect(await readSeoulOpenJson(new Response('  {"a":1}'), "x")).toEqual({ a: 1 });
    expect(await readSeoulOpenJson(new Response("[1,2]"), "x")).toEqual([1, 2]);
  });

  it("중첩 RESULT에 담긴 오류 코드도 throw하고 메시지를 싣는다", () => {
    expect(() =>
      parseCongestion({
        RESULT: { "RESULT.CODE": "INFO-100", "RESULT.MESSAGE": "인증키가 유효하지 않습니다." },
      }),
    ).toThrow(/INFO-100.*인증키/);
  });
});
