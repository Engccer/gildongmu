import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import { TRANSIT_TEXT_ARG_NAMES, namedArgs } from "../transit-text-args";
import { TRANSIT_TEXT_KEYS } from "../transit-guide-text";

const messages = (ko as { transitGuide: Record<string, string> }).transitGuide;

describe("TRANSIT_TEXT_ARG_NAMES — descriptor ↔ next-intl 어댑터 표", () => {
  it("descriptor가 낼 수 있는 모든 키가 표에 있다", () => {
    for (const key of TRANSIT_TEXT_KEYS) {
      expect(TRANSIT_TEXT_ARG_NAMES, key).toHaveProperty(key);
    }
  });

  it("표의 이름이 ko 메시지의 플레이스홀더와 이름·개수·순서까지 같다", () => {
    for (const [key, names] of Object.entries(TRANSIT_TEXT_ARG_NAMES)) {
      const template = messages[key];
      expect(template, `messages/ko.json transitGuide.${key}`).toBeDefined();
      const placeholders = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      // 위치 인자는 **ko 문장 등장 순서**가 정본이라 순서까지 같아야 한다(iOS 인덱스 계약).
      expect(names, key).toEqual(placeholders);
    }
  });

  it("표에 descriptor가 내지 않는 유령 키가 없다", () => {
    const known = new Set<string>(TRANSIT_TEXT_KEYS);
    for (const key of Object.keys(TRANSIT_TEXT_ARG_NAMES)) {
      expect(known.has(key), `유령 키: ${key}`).toBe(true);
    }
  });

  it("namedArgs가 위치 인자를 이름으로 옮긴다", () => {
    expect(namedArgs("boardedCount", ["Line 5", "Gwanghwamun", "8"])).toEqual({
      line: "Line 5",
      stop: "Gwanghwamun",
      count: "8",
    });
  });
});
