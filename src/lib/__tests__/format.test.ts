import { describe, it, expect } from "vitest";
import {
  formatDistance,
  durationToMinutes,
  joinText,
  normalizeVoiceQuery,
} from "../format";

/**
 * 거리 표기 경계표: **웹·Kit·CLI 세 구현의 공유 정본**(스펙
 * `2026-08-02-beacon-feedback-design.md` §2.2). 드리프트 가드가 이 표를 읽어
 * Swift 테스트와 대조하므로 `[입력, 기대]` 리터럴 형태를 유지한다.
 *
 * Swift는 `Int`만 받으므로 소수 입력은 아래 별도 케이스로 뺀다.
 */
export const DISTANCE_CASES: [number, string][] = [
  [120, "120m"],
  [999, "999m"],
  [1000, "1km"],
  [1049, "1km"],
  [1050, "1km 100m"],
  [1187, "1km 200m"],
  [1999, "2km"],
  [3640, "3km 600m"],
  [89700, "89km 700m"],
];

describe("formatDistance", () => {
  it.each(DISTANCE_CASES)("%dm → %s", (meters, expected) => {
    expect(formatDistance(meters)).toBe(expected);
  });

  it("1km 미만은 반올림한 미터", () => {
    expect(formatDistance(120.4)).toBe("120m");
  });

  // 1,000 미만 판정을 반올림 **앞에서** 하던 선재 결함. 999.6이 "1000m"이었다.
  it("999.6은 1000m이 아니라 1km", () => {
    expect(formatDistance(999.6)).toBe("1km");
  });

  // 100m 단위 반올림을 km·나머지로 따로 하면 여기서 "1km 1000m"이 나온다.
  it("자리올림이 나머지에 남지 않는다", () => {
    expect(formatDistance(1999)).toBe("2km");
    expect(formatDistance(1950)).toBe("2km");
    expect(formatDistance(9999)).toBe("10km");
  });

  // 소수 km 표기는 낭독이 길어 폐기했다("일 점 영 킬로미터").
  it("소수점을 쓰지 않는다", () => {
    for (const [meters] of DISTANCE_CASES) {
      expect(formatDistance(meters)).not.toMatch(/\./);
    }
  });
});

describe("durationToMinutes", () => {
  it("올림, 최소 1분", () => {
    expect(durationToMinutes(0)).toBe(1);
    expect(durationToMinutes(61)).toBe(2);
  });
});

describe("joinText (스크린 리더 한 줄 합치기)", () => {
  it("조각을 쉼표+공백으로 합친다", () => {
    expect(joinText("강남", "2호선, 신분당선", "약 120m")).toBe(
      "강남, 2호선, 신분당선, 약 120m",
    );
  });
  it("falsy 조각(선택 항목)은 버린다", () => {
    expect(joinText("성수행", "2호선", false, null, undefined, "")).toBe(
      "성수행, 2호선",
    );
  });
  it("조건부 배지를 cond && text로 흡수한다", () => {
    const express = true;
    const transfer = false;
    expect(joinText("성수행", express && "급행", transfer && "환승역")).toBe(
      "성수행, 급행",
    );
  });
  it("단일·빈 입력", () => {
    expect(joinText("강남")).toBe("강남");
    expect(joinText()).toBe("");
    expect(joinText(false, null, "")).toBe("");
  });
  it("가운뎃점을 구분자로 쓰지 않는다(쉼표만)", () => {
    expect(joinText("a", "b")).not.toContain("·");
  });
});

describe("normalizeVoiceQuery (음성 전사 → 검색어)", () => {
  it("후행 마침표를 제거한다: juso가 0건으로 전멸하던 실측 케이스", () => {
    expect(normalizeVoiceQuery("강동구 성내로 12.")).toBe("강동구 성내로 12");
    expect(normalizeVoiceQuery("서울 강동구 양재대로 1401.")).toBe(
      "서울 강동구 양재대로 1401",
    );
  });
  it("물음표·느낌표·말줄임표와 연속 부호도 제거한다", () => {
    expect(normalizeVoiceQuery("강동구 맛집?")).toBe("강동구 맛집");
    expect(normalizeVoiceQuery("길동역!")).toBe("길동역");
    expect(normalizeVoiceQuery("천호동...")).toBe("천호동");
  });
  it("부호 뒤 공백까지 함께 제거한다", () => {
    expect(normalizeVoiceQuery("천호대로 1077.  ")).toBe("천호대로 1077");
    expect(normalizeVoiceQuery("  강동구청  ")).toBe("강동구청");
  });
  it("부호와 공백이 섞인 꼬리도 한 번에 걷는다(iOS 미러 동형성)", () => {
    expect(normalizeVoiceQuery("강동구청 . , ")).toBe("강동구청");
  });
  it("중간 문장부호는 보존한다(사용자가 실제 발화한 구분일 수 있다)", () => {
    expect(normalizeVoiceQuery("길동 442-1, 3층.")).toBe("길동 442-1, 3층");
    expect(normalizeVoiceQuery("S.M. 엔터테인먼트")).toBe("S.M. 엔터테인먼트");
  });
  it("부호를 지우면 빈 문자열이 되는 입력은 원문을 되돌린다", () => {
    expect(normalizeVoiceQuery(".")).toBe(".");
    expect(normalizeVoiceQuery("  ...  ")).toBe("...");
  });
  it("부호가 없으면 그대로 통과한다", () => {
    expect(normalizeVoiceQuery("강동구 길동 맛집")).toBe("강동구 길동 맛집");
    expect(normalizeVoiceQuery("")).toBe("");
  });
});
