import { describe, expect, it } from "vitest";
import { buildRouteRefTable } from "../route-refs";

describe("routeRef 표(W2 spec §4)", () => {
  it("순번 base36이고 경로 키를 출력에 싣지 않는다", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `odsay/route#${i}`);
    const table = buildRouteRefTable(keys);
    expect(table.size).toBe(40);
    expect(table.refOf(keys[0])).toBe("0");
    expect(table.refOf(keys[36])).toBe("10");
    expect(table.keyOf("z")).toBe(keys[35]);
    expect(table.keyOf("nope")).toBeNull();
    expect(table.refOf("unknown")).toBeNull();
    for (const key of keys) expect(table.refOf(key)).toMatch(/^[a-z0-9]+$/);
  });
});
