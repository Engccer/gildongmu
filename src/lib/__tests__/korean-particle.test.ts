import { describe, expect, it } from "vitest";
import {
  directionParticle,
  hasFinalConsonant,
  objectParticle,
  subjectParticle,
  topicParticle,
} from "../korean-particle";

/**
 * ⚠ 이 표는 Swift `KoreanParticleTests`와 **같은 케이스**를 든다. 한쪽만 고치면
 * 두 플랫폼의 낭독이 갈린다(`format.ts` ↔ `Format.swift` drift 선례와 동형).
 */
export const PARTICLE_CASES: Array<{
  word: string;
  final: boolean | null;
  object: string | null;
  subject: string | null;
  topic: string | null;
  direction: string | null;
}> = [
  // 받침 없음 — 실측 도로명 다수가 "…로"로 끝난다.
  { word: "성내로", final: false, object: "를", subject: "가", topic: "는", direction: "로" },
  { word: "천호대로", final: false, object: "를", subject: "가", topic: "는", direction: "로" },
  { word: "이마트", final: false, object: "를", subject: "가", topic: "는", direction: "로" },
  // ㄹ 받침 — 을/이/은인데 "(으)로"만 "로"로 간다(서울로·명일로24길로).
  { word: "명일로24길", final: true, object: "을", subject: "이", topic: "은", direction: "로" },
  // 그 외 받침.
  { word: "강동구청", final: true, object: "을", subject: "이", topic: "은", direction: "으로" },
  { word: "봉래면옥", final: true, object: "을", subject: "이", topic: "은", direction: "으로" },
  // 한글이 아닌 끝 — 읽는 법이 정해지지 않아 판정 불가.
  { word: "GS25", final: null, object: null, subject: null, topic: null, direction: null },
  { word: "스타벅스 R", final: null, object: null, subject: null, topic: null, direction: null },
  { word: "자택 아파트 101", final: null, object: null, subject: null, topic: null, direction: null },
  { word: "카페(임시)", final: null, object: null, subject: null, topic: null, direction: null },
  { word: "", final: null, object: null, subject: null, topic: null, direction: null },
];

describe("korean-particle", () => {
  it.each(PARTICLE_CASES)("$word", ({ word, final, object, subject, topic, direction }) => {
    expect(hasFinalConsonant(word)).toBe(final);
    expect(objectParticle(word)).toBe(object);
    expect(subjectParticle(word)).toBe(subject);
    expect(topicParticle(word)).toBe(topic);
    expect(directionParticle(word)).toBe(direction);
  });

  it("판정 불가면 null이라 호출자가 대체 문형을 고를 수 있다", () => {
    // ⚠ 빈 문자열을 돌려주면 조사 없는 문장이 조용히 나간다.
    expect(objectParticle("GS25")).toBeNull();
  });
});
