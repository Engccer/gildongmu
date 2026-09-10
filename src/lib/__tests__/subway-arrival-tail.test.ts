import { describe, expect, it } from "vitest";
import { arrivalItems, subwayShowsCurrentLocationTail } from "../place-lines/station-arrivals";
import type { SubwayArrival } from "../types";
import cases from "./fixtures/subway-arrival-tail-cases.json";

/**
 * A32 — 완성 문장이 이미 담고 있는 현재역을 꼬리로 또 붙이지 않는다.
 * 판정 함수는 Kit `subwayShowsCurrentLocationTail`과 같은 fixture를 읽는다(두 구현 동조).
 */
const t = (k: string, v?: Record<string, unknown>) => (v ? `${k}${JSON.stringify(v)}` : k);

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

describe("현재역 꼬리 판정 (A32)", () => {
  it("공유 fixture 전 행이 Kit과 같은 답을 낸다", () => {
    expect(cases.cases.length).toBeGreaterThanOrEqual(20);
    for (const c of cases.cases) {
      expect(subwayShowsCurrentLocationTail(c.message, c.currentLocation), c.name).toBe(c.expect);
    }
  });

  it("미지 문법은 꼬리를 남긴다 — 실패 방향이 현행이다", () => {
    expect(subwayShowsCurrentLocationTail("우리가 모르는 새 문장", "강일")).toBe(true);
  });
});

describe("arrivalItems — 꼬리가 실제 줄에서 빠진다", () => {
  it("ko: 문장이 현재역을 담으면 `현재 {역}`이 사라진다", () => {
    expect(arrivalItems([BASE], t)[0].message).toBe("6분 후 (강일)");
  });

  it("ko: 문장에 없으면 그대로 붙는다", () => {
    const items = arrivalItems([{ ...BASE, message: "전역 도착", currentLocation: "고덕" }], t);
    expect(items[0].message).toBe('전역 도착, currentLocation{"location":"고덕"}');
  });

  it("en: 영문 문장은 현재역을 담지 않으므로 꼬리가 남는다 — ko 축으로 판정하면 여기서 정보가 사라진다", () => {
    const en: SubwayArrival = {
      ...BASE,
      lineEn: "Line 5",
      directionEn: "Up",
      trainLineNmEn: "To Banghwa via Gubeundari",
      messageEn: "In 6 min",
      currentLocationEn: "Gangil",
    };
    const items = arrivalItems([en], t, "en");
    expect(items[0].message).toBe('In 6 min, currentLocation{"location":"Gangil"}');
    // ko 줄은 같은 항목에서도 꼬리가 빠진다(축이 언어별로 갈린다)
    expect(arrivalItems([en], t)[0].message).toBe("6분 후 (강일)");
  });

  it("en: 영문 문장이 역명을 담으면(당역 도착 계열) 꼬리가 빠지고 순수 데이터 줄이 된다", () => {
    const en: SubwayArrival = {
      ...BASE,
      message: "강일 도착",
      lineEn: "Line 5",
      directionEn: "Up",
      trainLineNmEn: "To Banghwa via Gubeundari",
      messageEn: "Arrived at Gangil",
      currentLocationEn: "Gangil",
    };
    const items = arrivalItems([en], t, "ja");
    expect(items[0].message).toBe("Arrived at Gangil");
    // UI 템플릿이 섞이지 않은 영어 줄이라 비-en 로케일에서 lang=en 태그가 붙는다
    expect(items[0].messageLang).toBe("en");
  });

  it("en: 현재역 영문이 없으면 줄 전체가 한국어 원문이다(줄 단위 원자성 불변)", () => {
    const partial: SubwayArrival = {
      ...BASE,
      message: "전역 도착",
      currentLocation: "고덕",
      lineEn: "Line 5",
      directionEn: "Up",
      trainLineNmEn: "To Banghwa via Gubeundari",
      messageEn: "Arrived at previous station",
    };
    const items = arrivalItems([partial], t, "en");
    expect(items[0].message).toBe('전역 도착, currentLocation{"location":"고덕"}');
    expect(items[0].messageLang).toBe("ko");
  });
});
