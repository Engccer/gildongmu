import { describe, expect, it } from "vitest";
import cases from "./fixtures/transit-alternative-name-cases.json";
import { alternativeName, alternativeNameParts } from "../transit-alternative-name";
import type { TransitHighlight } from "../types";

// 공유 fixture — Kit `TransitAlternativeNameTests`·`:kit` `TransitAlternativeNameTest`가 같은 표를 읽는다.
describe("alternativeNameParts (공유 fixture)", () => {
  it.each(cases.cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const parts = alternativeNameParts({
      highlight: (c.highlight ?? undefined) as TransitHighlight[] | undefined,
      displayIndex: c.displayIndex ?? undefined,
    });
    expect(parts.map((p) => ({ key: `route.transit.${p.key}`, index: (p.values.index as number | undefined) ?? null }))).toEqual(c.parts);
  });
});

describe("alternativeName", () => {
  it("조각을 쉼표로 이어 한 줄로 만든다(가운뎃점 없음)", () => {
    const name = alternativeName({ highlight: ["busOnly", "fewestTransfers"] }, (key) => `<${key}>`);
    expect(name).toBe("<alternativeFewestTransfers>, <alternativeBusOnly>");
  });
});
