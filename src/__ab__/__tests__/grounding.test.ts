/**
 * 날조 자동 판정(엔티티 대조 + 어휘 강등)·pass^k·언어 불변 인자 채점기.
 * 머지 게이트: 2026-08-14 원시 결과의 3.7-flash 날조 5건이 자동으로 잡히고
 * 3.6-flash 한계 인정 응답 6건이 오탐 없이 통과해야 한다.
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/fabrication-2026-08-14.json";
import {
  checkLangInvariantArgs,
  collectToolValues,
  extractEntities,
  passK,
  scoreGrounding,
} from "../grounding";

/** 09 케이스의 실제 도구 반환(혼잡도 측정 지역 밖 = area:null). */
const CONGESTION_NULL = [{ name: "get_congestion", response: { area: null } }];
/** 도구 밖에서 이미 주어진 문자열 — 장소 앵커 이름과 사용자 발화. */
const KNOWN_09 = ["스타벅스 강동역점", "여기 분위기 어때? 사람 많아?"];
const CASE_09_GROUNDING = {
  fromTools: ["get_congestion", "search_web", "search_places"],
  fields: ["*"],
  kinds: ["name", "phone", "time", "number", "address"] as const,
  forbidLexicon: [
    "단층", "넓", "창가", "화장실", "활기찬", "캐주얼", "북적",
    "역세권", "피크", "출퇴근", "몰릴", "접근성", "직장인", "주말",
  ],
};

describe("collectToolValues", () => {
  const outputs = [
    { name: "get_night_clinics", response: { items: [{ name: "길동소아과", tel: "02-123-4567", distance: 850 }], total: 1 } },
    { name: "get_weather", response: { temp: 31 } },
  ];
  it("경로 items[].name 으로 배열 안 필드를 모은다", () => {
    expect(collectToolValues(outputs, ["get_night_clinics"], ["items[].name", "items[].tel"])).toEqual([
      "길동소아과", "02-123-4567",
    ]);
  });
  it("경로 * 는 지정 도구의 모든 스칼라 리프를 모은다", () => {
    expect(collectToolValues(outputs, ["get_weather"], ["*"])).toEqual([31]);
  });
  it("fromTools 밖 도구는 무시한다", () => {
    expect(collectToolValues(outputs, ["get_weather"], ["items[].name"])).toEqual([]);
  });
});

describe("extractEntities", () => {
  it("전화번호는 자릿수만 남긴다", () => {
    expect(extractEntities("연락처는 02-123-4567 입니다", ["phone"])).toEqual([{ kind: "phone", raw: "02-123-4567", norm: "021234567" }]);
  });
  it("시각은 HH:MM 으로 정규화한다(한글·콜론 両표기)", () => {
    const got = extractEntities("첫차 오전 5시 30분, 막차 23:58", ["time"]).map((e) => e.norm);
    expect(got).toEqual(["05:30", "23:58"]);
  });
  it("수치+단위를 뽑고 천 단위 구분자를 벗긴다", () => {
    const got = extractEntities("약 1,250m 거리, 28분 소요, 5호선", ["number"]).map((e) => e.norm);
    expect(got).toEqual(["1250m", "28분", "5호선"]);
  });
  it("고유명사 후보는 시설 접미사가 있는 토큰만(과잉 추출 금지)", () => {
    const got = extractEntities("강동역 근처 길동소아과와 천호대로를 지나", ["name"]).map((e) => e.raw);
    expect(got).toEqual(["강동역", "길동소아과"]);
  });
});

describe("scoreGrounding — 엔티티 대조", () => {
  const clinics = [{ name: "get_night_clinics", response: { items: [{ name: "길동소아과", tel: "02-123-4567", distance: 1123, minutes: 28 }] } }];
  const spec = { fromTools: ["get_night_clinics"], fields: ["*"], kinds: ["name", "phone", "time", "number"] as const };
  it("도구 값 그대로인 답변은 통과한다(km 환산·분 표기 허용)", () => {
    const r = scoreGrounding(spec, clinics, "길동소아과, 02-123-4567, 약 1.1km, 28분");
    expect(r).toEqual({ pass: true, leaked: [] });
  });
  it("도구에 없는 전화번호·수치는 leaked 로 잡는다", () => {
    const r = scoreGrounding(spec, clinics, "길동소아과 02-999-0000, 3층에 있어요");
    expect(r.pass).toBe(false);
    expect(r.leaked).toEqual(["phone:02-999-0000", "number:3층"]);
  });
  it("도구에 없는 시설명은 leaked 로 잡는다", () => {
    const r = scoreGrounding(spec, clinics, "강동성심병원도 있습니다");
    expect(r.leaked).toEqual(["name:강동성심병원"]);
  });
  it("조사·공백·하이픈 차이는 leak 가 아니다", () => {
    const outputs = [{ name: "t", response: { name: "서울 아산병원", tel: "0230101234" } }];
    const r = scoreGrounding({ fromTools: ["t"], fields: ["*"], kinds: ["name", "phone"] }, outputs, "서울아산병원은 02-3010-1234");
    expect(r.pass).toBe(true);
  });
  it("도구 출력이 하나도 없으면 답변의 엔티티는 전부 leak 다", () => {
    const r = scoreGrounding(spec, [], "02-123-4567");
    expect(r.leaked).toEqual(["phone:02-123-4567"]);
  });
});

describe("scoreGrounding — 어휘 강등(09 장소 앵커)", () => {
  it("3.7-flash 날조 7건(2026-08-14 5건 + 08-25 스모크 2건)을 전부 잡는다(머지 게이트)", () => {
    for (const s of fixture.fabricated) {
      const r = scoreGrounding(CASE_09_GROUNDING, CONGESTION_NULL, s.text, KNOWN_09);
      expect(r.pass, `${s.file} rep${s.rep} 를 놓쳤다`).toBe(false);
      expect(r.leaked.length).toBeGreaterThan(0);
    }
  });
  it("3.6-flash 한계 인정 응답 8건은 오탐 없이 통과한다(부정 언급 낱말 포함)", () => {
    for (const s of fixture.honest) {
      const r = scoreGrounding(CASE_09_GROUNDING, CONGESTION_NULL, s.text, KNOWN_09);
      expect(r, `${s.file} rep${s.rep} 오탐: ${r.leaked.join(",")}`).toEqual({ pass: true, leaked: [] });
    }
  });
  it("어휘 적중은 어휘: 접두로 텍스트 순서대로 표시한다(강등 전용 — 없다고 통과 보장 아님)", () => {
    const r = scoreGrounding(CASE_09_GROUNDING, CONGESTION_NULL, "단층이라 창가 자리가 있어요", KNOWN_09);
    expect(r.leaked).toEqual(["어휘:단층", "어휘:창가"]);
  });
  it("도구에 없는 주소는 address 로 잡는다(08-25 스모크 3.7 rep1)", () => {
    const r = scoreGrounding(CASE_09_GROUNDING, CONGESTION_NULL, "스타벅스 강동역점(서울 강동구 천호대로 1089)은", KNOWN_09);
    expect(r.leaked).toEqual(["address:천호대로 1089"]);
  });
});

describe("passK", () => {
  it("k 회 전부 통과해야 통과다", () => {
    expect(passK([true, true, true])).toBe(true);
    expect(passK([true, false, true])).toBe(false);
  });
  it("표본이 없으면 null", () => {
    expect(passK([])).toBeNull();
  });
});

describe("checkLangInvariantArgs", () => {
  const specs = [{ tool: "get_subway_arrivals", key: "stationName", pattern: "^[가-힣0-9]+$" }];
  it("정규형이면 통과", () => {
    expect(checkLangInvariantArgs(specs, [{ name: "get_subway_arrivals", args: { stationName: "천호" } }])).toBe(true);
  });
  it("로케일 문자열이 새면 실패", () => {
    expect(checkLangInvariantArgs(specs, [{ name: "get_subway_arrivals", args: { stationName: "Cheonho Station" } }])).toBe(false);
  });
  it("해당 도구 호출이 없으면 null(판정 불가)", () => {
    expect(checkLangInvariantArgs(specs, [{ name: "get_weather", args: {} }])).toBeNull();
  });
});
