import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import {
  arrivalItems,
  arrivalProseSegments,
  planStation,
  renderArrivalProse,
  subwayArrivalProse,
} from "../place-lines/station-arrivals";
import type { TranslateFn } from "../place-lines/translate";
import type { SubwayArrival } from "../types";
import cases from "./fixtures/subway-arrival-prose-cases.json";

/**
 * E37 — 서울시 완성 문장을 읽어 우리 문장으로 다시 쓴다. 계획 함수는 Kit `subwayArrivalProse`와 같은
 * fixture를 읽는다(두 구현 동조). 렌더는 실제 `messages/*.json`으로 본다 — 낭독 문장의 정본은 문자열 자원.
 */
function tFor(locale: string, messages: Record<string, unknown>): TranslateFn {
  // 키를 리터럴 유니온으로 좁히는 next-intl 추론을 푼다 — 이 테스트는 키를 fixture에서 받는다.
  return createTranslator({ locale, messages, namespace: "subwayArrival" }) as unknown as TranslateFn;
}
const tKo = tFor("ko", ko);
const tEn = tFor("en", en);
const tJa = tFor("ja", ja);

const BASE: SubwayArrival = {
  line: "5호선",
  direction: "상행",
  trainLineNm: "방화행 - 굽은다리방면",
  destination: "방화",
  message: "6분 후 (강일)",
  currentLocation: "강일",
  arrivalSeconds: 360,
  express: false,
};
const EN_FIELDS = {
  lineEn: "Line 5",
  directionEn: "Up",
  trainLineNmEn: "To Banghwa via Gubeundari",
};

describe("subwayArrivalProse — 공유 fixture", () => {
  it("전 행이 Kit과 같은 계획을 낸다", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(40);
    for (const c of cases.cases) {
      expect(subwayArrivalProse(c.message, c.currentLocation), c.name).toEqual(c.expect);
    }
  });

  it("키 선택도 Kit과 같다 — 어느 문장을 고르는가가 fixture에 잠겨 있다", () => {
    for (const c of cases.cases) {
      const plan = subwayArrivalProse(c.message, c.currentLocation);
      if (!plan) {
        expect("keys" in c, c.name).toBe(false);
        continue;
      }
      const segs = arrivalProseSegments(plan, planStation(plan));
      const keys = (c as { keys?: { joined: string[]; tail?: string } }).keys;
      expect(keys, c.name).toBeDefined();
      expect(segs.joined.map((x) => x.key), c.name).toEqual(keys!.joined);
      expect(segs.tail?.key, c.name).toBe(keys!.tail);
    }
  });

  it("barvlDt·arvlCd는 판정에 들어가지 않는다 — 인자 자체가 없다", () => {
    expect(subwayArrivalProse.length).toBe(2);
  });
});

describe("renderArrivalProse — ko 문장(실제 문자열 자원)", () => {
  const rows: Array<[string, string | null, string]> = [
    ["서울 진입", "서울", "서울 진입."],
    ["서울 도착", "서울", "서울 도착."],
    ["서울 출발", "서울", "서울 출발."],
    ["전역 진입", "남영", "1정거장 전 남영 진입."],
    ["전역 도착", "남영", "1정거장 전 남영 도착."],
    ["전역 출발", "시청", "1정거장 전 시청에서 출발."],
    ["강일 전역출발", "강일", "1정거장 전에서 출발."],
    ["전전역 출발", "미사", "2정거장 전에서 출발."],
    ["전전역 출발", null, "2정거장 전에서 출발."],
    ["[4]번째 전역 (하남검단산)", "하남검단산", "4정거장 전 하남검단산에 있습니다."],
    ["4분 후 (삼각지)", "삼각지", "4분 후 도착. 현재 삼각지."],
    ["4분 30초 후", "방배", "4분 30초 후 도착. 현재 방배."],
    ["9분 후", null, "9분 후 도착."],
    ["15초 후 (불암산)", "불암산", "15초 후 도착. 현재 불암산."],
    ["3분 후(2번째 전)", "방배", "2정거장 전, 3분 후 도착. 현재 방배."],
  ];
  for (const [message, loc, expected] of rows) {
    it(`${message} → ${expected}`, () => {
      const items = arrivalItems([{ ...BASE, message, currentLocation: loc ?? undefined }], tKo);
      expect(items[0].message).toBe(expected);
      expect(items[0].messageLang).toBeUndefined();
    });
  }

  it("못 알아보는 문장은 원문 그대로 + A32 꼬리(현행)", () => {
    const items = arrivalItems([{ ...BASE, message: "곧 도착", currentLocation: "강일" }], tKo);
    expect(items[0].message).toBe("곧 도착, 현재 강일");
  });

  it("위치를 신뢰할 수 없는 두 문법은 역명을 어디에도 싣지 않는다", () => {
    // `강일 전역출발`의 강일은 조회 역 자신(12/12), `전전역 출발`의 미사는 한 역 앞(2/2)이라
    // 둘 다 열차 위치가 아니다 — 실으면 없는 곳을 현재 위치로 낭독한다.
    for (const [message, loc] of [["강일 전역출발", "강일"], ["전전역 출발", "미사"]] as const) {
      const line = arrivalItems([{ ...BASE, message, currentLocation: loc }], tKo)[0].message;
      expect(line).not.toContain(loc);
    }
  });
});

describe("en 계열 로케일 — 문장형 줄의 언어(E27 원자성 + A38)", () => {
  it("구 문법의 정거장 조각도 로케일 문장이다", () => {
    const a: SubwayArrival = { ...BASE, ...EN_FIELDS, message: "3분 후(2번째 전)", currentLocation: "방배", currentLocationEn: "Bangbae" };
    expect(arrivalItems([a], tEn, "en")[0].message).toBe("2 stops away, Arriving in 3 min. Now at Bangbae.");
  });

  it("영문 역명이 있으면 UI 언어 문장 + 영문 역명, 태그 없음", () => {
    const a: SubwayArrival = { ...BASE, ...EN_FIELDS, messageEn: "In 6 min", currentLocationEn: "Gangil" };
    const items = arrivalItems([a], tEn, "en");
    expect(items[0].message).toBe("Arriving in 6 min. Now at Gangil.");
    expect(items[0].messageLang).toBeUndefined();
  });

  it("ja 로케일은 일본어 문장 + 영문 역명이고 lang=en을 달지 않는다(UI 템플릿 줄)", () => {
    const a: SubwayArrival = { ...BASE, ...EN_FIELDS, message: "[4]번째 전역 (하남검단산)", currentLocation: "하남검단산", currentLocationEn: "Hanam Geomdansan" };
    const items = arrivalItems([a], tJa, "ja");
    expect(items[0].message).toBe("4駅前のHanam Geomdansanにいます。");
    expect(items[0].messageLang).toBeUndefined();
  });

  it("A38: arvlMsg3가 비고 현재역이 괄호로만 와도 영문 줄은 자기 값으로 현재역을 싣는다", () => {
    const a: SubwayArrival = {
      ...BASE,
      ...EN_FIELDS,
      message: "5분 후 (종각)",
      currentLocation: undefined,
      messageEn: "In 5 min",
      currentLocationEn: "Jonggak",
    };
    expect(arrivalItems([a], tEn, "en")[0].message).toBe("Arriving in 5 min. Now at Jonggak.");
    expect(arrivalItems([a], tKo)[0].message).toBe("5분 후 도착. 현재 종각.");
  });

  it("역이 필요한데 영문 역명이 없으면 문장형을 버리고 원문 경로로 떨어진다(줄 원자성)", () => {
    // 영어 문장에 한국어 역명을 끼우지 않는다 — 그 줄은 통째로 한국어 원문 + lang=ko다.
    const a: SubwayArrival = { ...BASE, ...EN_FIELDS, messageEn: "In 6 min", currentLocationEn: undefined };
    const items = arrivalItems([a], tEn, "en");
    expect(items[0].message).toBe("6분 후 (강일)");
    expect(items[0].messageLang).toBe("ko");
  });

  it("역이 필요 없는 계획은 영문 역명 없이도 UI 언어 줄이다", () => {
    const a: SubwayArrival = { ...BASE, ...EN_FIELDS, message: "9분 후", currentLocation: undefined, currentLocationEn: undefined };
    const items = arrivalItems([a], tEn, "en");
    expect(items[0].message).toBe("Arriving in 9 min.");
    expect(items[0].messageLang).toBeUndefined();
  });

  it("복수형: 1정거장 / 2정거장 (ICU plural)", () => {
    expect(renderArrivalProse({ kind: "departedStopsBack", count: 1 }, undefined, tEn)).toBe(
      "Departed the station 1 stop back.",
    );
    expect(renderArrivalProse({ kind: "stopsAway", count: 2, station: "Gangnam" }, "Gangnam", tEn)).toBe(
      "2 stops away, at Gangnam.",
    );
  });

  it("원문 경로의 A38: 미지 문법이라도 영문 값이 있으면 꼬리에 싣고, 영문이 없고 ko만 있으면 줄 전체 ko", () => {
    const withEn: SubwayArrival = {
      ...BASE,
      ...EN_FIELDS,
      message: "곧 도착",
      currentLocation: undefined,
      messageEn: "Arriving soon",
      currentLocationEn: "Gangil",
    };
    const items = arrivalItems([withEn], tEn, "en");
    expect(items[0].message).toBe("Arriving soon, Now at Gangil");
    const koOnly: SubwayArrival = { ...withEn, currentLocation: "강일", currentLocationEn: undefined };
    const fallback = arrivalItems([koOnly], tEn, "en");
    expect(fallback[0].message).toBe("곧 도착, Now at 강일");
    expect(fallback[0].messageLang).toBe("ko");
  });
});
