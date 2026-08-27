import { describe, expect, it } from "vitest";
import {
  buildRouteRefTable,
  focusTargetSelector,
  guideTriggerSelector,
  isPlanScoped,
  isValidTargetId,
  parseTargetId,
  targetId,
} from "../targets";

describe("착지 ID 체계(spec §3.3)", () => {
  it("생성 → 파싱 왕복", () => {
    const cases = [
      [targetId.field("from"), { scope: "view", kind: "field", field: "from" }],
      [targetId.field("via"), { scope: "view", kind: "field", field: "via" }],
      [targetId.submit(), { scope: "view", kind: "control", control: "submit" }],
      [targetId.guidancePanel(), { scope: "view", kind: "guidance" }],
      [targetId.mode("transit"), { scope: "plan", kind: "mode", mode: "transit" }],
      [targetId.transitRoute("a"), { scope: "plan", kind: "transitRoute", routeRef: "a" }],
      [targetId.transitLeg("1", 3), { scope: "plan", kind: "transitLeg", routeRef: "1", n: 3 }],
      [targetId.step("walk", 12), { scope: "plan", kind: "step", mode: "walk", n: 12 }],
      [targetId.step("car", 1), { scope: "plan", kind: "step", mode: "car", n: 1 }],
    ] as const;
    for (const [id, parsed] of cases) {
      expect(isValidTargetId(id)).toBe(true);
      expect(parseTargetId(id)).toEqual(parsed);
    }
  });

  it("허용 문자 밖·모양이 다른 ID는 null", () => {
    for (const bad of [
      "field:FROM",
      "field:x",
      "mode:bike",
      "transit:route:",
      "transit:leg:0:0",
      "walk:step:1.5",
      "walk:step:-1",
      'a"b',
      "강남역",
      "transit:route:0:extra",
      "",
    ]) {
      expect(parseTargetId(bad), bad).toBeNull();
    }
  });

  it("계획 범위는 mode·route·leg·step뿐이다", () => {
    expect(isPlanScoped(parseTargetId("field:to")!)).toBe(false);
    expect(isPlanScoped(parseTargetId("guidance:panel")!)).toBe(false);
    expect(isPlanScoped(parseTargetId("mode:walk")!)).toBe(true);
    expect(isPlanScoped(parseTargetId("car:step:2")!)).toBe(true);
  });

  it("routeRef 표는 순번 base36이고 경로 키를 DOM에 싣지 않는다", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `odsay/route#${i}`);
    const table = buildRouteRefTable(keys);
    expect(table.size).toBe(40);
    expect(table.refOf(keys[0])).toBe("0");
    expect(table.refOf(keys[36])).toBe("10");
    expect(table.keyOf("z")).toBe(keys[35]);
    expect(table.keyOf("nope")).toBeNull();
    expect(table.refOf("unknown")).toBeNull();
    for (const key of keys) expect(isValidTargetId(targetId.transitRoute(table.refOf(key)!))).toBe(true);
  });

  it("선택자는 허용 문자만 통과시킨다", () => {
    // `:`는 CSS.escape도 이스케이프한다(따옴표 속성값이라 이스케이프는 무해하다).
    expect(focusTargetSelector("walk:step:3")).toBe('[data-focus-target="walk\\:step\\:3"]');
    expect(focusTargetSelector('x"]')).toBeNull();
    expect(guideTriggerSelector("transit:1")).toBe('[data-guide-trigger="transit\\:1"]');
    expect(guideTriggerSelector("bad value")).toBeNull();
  });
});
