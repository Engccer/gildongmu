import { describe, it, expect } from "vitest";
import { findVoiceGuides, VOICE_GUIDES_AS_OF } from "../voice-guides";
import { normalizeStationName } from "../station-match";

describe("음성유도기 seed", () => {
  it("강동역 설치 위치가 조회된다(실 seed)", () => {
    const items = findVoiceGuides(normalizeStationName("강동역 5호선"));
    expect(items.length).toBeGreaterThan(10);
    expect(items[0].location).toBeTruthy();
  });
  it("미커버 역은 빈 배열", () => {
    expect(findVoiceGuides(normalizeStationName("서면역"))).toEqual([]);
  });
  it("기준일 상수가 노출된다", () => {
    expect(VOICE_GUIDES_AS_OF).toMatch(/^\d{4}-\d{2}$/);
  });
  it("괄호 제거가 별개 역을 합치지 않는다: CSV 키의 괄호 변형은 동일 기저명뿐", () => {
    // seed 빌드 정규화의 안전성 스냅샷: 파이썬 normalize와 TS normalizeStationName이
    // 동일 결과를 내는지 CSV 유래 대표 변형으로 교차 검증
    for (const [rawName, expected] of [
      ["서울역 (1)", "서울"], ["동대문(4)", "동대문"], ["교대 (3)", "교대"],
      ["굽은다리(강동구민회관앞)", "굽은다리"],
    ] as const) {
      expect(normalizeStationName(rawName)).toBe(expected);
    }
  });
});
