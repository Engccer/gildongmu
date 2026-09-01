/**
 * 날조 자동 판정(엔티티 대조 + 어휘 강등)·pass^k·언어 불변 인자 채점기.
 * 머지 게이트: 2026-08-14 원시 결과의 3.7-flash 날조 5건(+08-25 스모크 2건)이 자동으로 잡히고
 * 3.6-flash 한계 인정 응답 8건 + 나올 법한 정직 문장(합성)이 오탐 없이 통과해야 한다.
 */
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/fabrication-2026-08-14.json";
import { CASES } from "../cases";
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
/** 프로덕션 케이스 09의 grounding spec 그대로(복사본 검사 금지 — 드리프트). */
const CASE_09_GROUNDING = CASES.find((c) => c.id === "09-날조축-장소앵커")!.grounding!;

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
  it("dodo 이식본 단위(도·유로·€)도 뽑는다(D27 — 두 이식본이 갈리지 않게)", () => {
    const got = extractEntities("기온 31도, 입장권 18유로, 커피 3.5€", ["number"]).map((e) => e.norm);
    expect(got).toEqual(["31도", "18유로", "3.5€"]);
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
  it("답변이 적은 자릿수만큼만 일치를 요구한다 — 1,123m를 '약 1km'로 반올림한 것은 날조가 아니다", () => {
    expect(scoreGrounding(spec, clinics, "약 1km 거리").pass).toBe(true);
    expect(scoreGrounding(spec, clinics, "약 2km 거리").pass).toBe(false);
    expect(scoreGrounding(spec, clinics, "1.2km 거리").pass).toBe(false);
  });
  it("조사 '로'+단위는 주소가 아니다('도보로 5분'·'버스로 10분')", () => {
    const r = scoreGrounding({ fromTools: ["t"], fields: ["*"], kinds: ["address"] }, [], "역까지 도보로 5분, 버스로 10분");
    expect(r).toEqual({ pass: true, leaked: [] });
  });
  it("좌표 숫자가 시각을 접지하지 않는다(127.1325 ≠ 13:25)", () => {
    const outputs = [{ name: "t", response: { lng: 127.1325, first: "05:30" } }];
    const r = scoreGrounding({ fromTools: ["t"], fields: ["*"], kinds: ["time"] }, outputs, "13:25에 오고 05:30에 첫차");
    expect(r.leaked).toEqual(["time:13:25"]);
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
  it("역 어간으로 온 도구 값('춘천')은 답변의 '춘천역'을 접지한다(C5 케이스 42)", () => {
    const outputs = [{ name: "get_subway_arrivals", response: { count: 0, arrivals: [], nearest: { stationName: "춘천", lines: ["경춘선"], distanceMeters: 65637 } } }];
    const g = { fromTools: ["get_subway_arrivals"], fields: ["*"], kinds: ["name", "number"] as const };
    expect(scoreGrounding(g, outputs, "주변에 지하철역이 없고, 가장 가까운 춘천역은 약 66km 떨어져 있습니다.")).toEqual({ pass: true, leaked: [] });
    expect(scoreGrounding(g, outputs, "가까운 강남역은 5분 거리").leaked).toEqual(["number:5분", "name:강남역"]);
  });
  it("역 어간 대조는 값 경계 안에서만 — 주소 '천호대로'가 '천호역'을 접지하지 않는다(리뷰 검출)", () => {
    const outputs = [{ name: "get_night_clinics", response: { clinics: [{ name: "길동소아과", address: "서울 강동구 천호대로 1077" }] } }];
    const g = { fromTools: ["get_night_clinics"], fields: ["*"], kinds: ["name"] as const };
    const r = scoreGrounding(g, outputs, "천호역, 강동역, 서울역 근처 길동소아과");
    expect(r.leaked).toEqual(["name:천호역", "name:강동역", "name:서울역"]);
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
  it("부정 술어가 있는 문장의 어휘는 한계 고지라 면제한다(합성 정직 문장)", () => {
    const honest = [
      "화장실 위치 정보는 제공되지 않습니다.",
      "휠체어 접근성이 좋은지는 도구에서 확인할 수 없습니다.",
      "창가 자리가 있는지, 넓은 매장인지는 알 수 없습니다.",
      "역까지 도보로 갈 수 있고, 버스로도 갈 수 있습니다.",
    ];
    for (const h of honest) {
      const r = scoreGrounding(CASE_09_GROUNDING, CONGESTION_NULL, h, KNOWN_09);
      expect(r, `오탐: ${h} → ${r.leaked.join(",")}`).toEqual({ pass: true, leaked: [] });
    }
  });
  it("어휘 적중은 어휘: 접두로 텍스트 순서대로 표시한다(강등 전용 — 없다고 통과 보장 아님)", () => {
    const r = scoreGrounding(CASE_09_GROUNDING, CONGESTION_NULL, "단층이라 창가 자리가 있어요", KNOWN_09);
    expect(r.leaked).toEqual(["어휘:단층", "어휘:창가 자리"]);
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
