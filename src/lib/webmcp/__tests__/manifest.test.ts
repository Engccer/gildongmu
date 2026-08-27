import { afterEach, describe, expect, it } from "vitest";
import { TOOL_NAMES, buildAppTools, manifest } from "../manifest";
import { __resetViewRegistryForTest } from "../view-registry";

const gates = { hasWalk: true, hasTransit: true, hasCar: true, canShowSubway: true, canShowBarrierFree: true };
afterEach(__resetViewRegistryForTest);

describe("manifest(spec §5.1)", () => {
  it("등록 이름 집합은 정확히 7개이고 manifest·TOOL_NAMES와 같다", () => {
    const names = buildAppTools(gates).map((t) => t.name);
    expect(new Set(names)).toEqual(
      new Set(["describe_app", "search_places", "get_place_info", "plan_directions", "get_transit_route_detail", "get_route_steps", "read_current_view"]),
    );
    expect(names).toHaveLength(7);
    expect(TOOL_NAMES).toEqual(manifest().map((d) => d.name));
  });
  it("이름 30자·[a-z_], 설명 500자, 파라미터 설명 150자, describe_app만 untrustedContentHint false", () => {
    for (const t of buildAppTools(gates)) {
      expect(t.name).toMatch(/^[a-z_]{1,30}$/);
      expect(t.description.length).toBeLessThanOrEqual(500);
      const props = (t.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      for (const p of Object.values(props)) expect((p.description ?? "").length).toBeLessThanOrEqual(150);
      expect(t.annotations.untrustedContentHint).toBe(t.name !== "describe_app");
    }
  });
  it("available은 게이트를 반영하고, 불가한 도구는 등록되되 실행 시 notConfigured", async () => {
    const none = { ...gates, hasWalk: false, hasTransit: false, hasCar: false };
    const defs = manifest();
    expect(defs.find((d) => d.name === "plan_directions")!.available(none)).toBe(false);
    expect(defs.find((d) => d.name === "get_transit_route_detail")!.available({ ...gates, hasTransit: false })).toBe(false);
    expect(defs.find((d) => d.name === "search_places")!.available(none)).toBe(true);
    const tools = buildAppTools(none);
    expect(tools).toHaveLength(7);
    expect(JSON.parse(await tools.find((t) => t.name === "plan_directions")!.execute({ to: "x" }))).toMatchObject({ ok: false, reason: "notConfigured" });
  });
  it("describe_app 출력의 tools 이름 = 등록 이름, axes에 arrivals·barrierFree 게이트, notes 5문장", async () => {
    const d = buildAppTools({ ...gates, canShowSubway: false }).find((t) => t.name === "describe_app")!;
    const out = JSON.parse(await d.execute({}));
    expect(out.tools.map((t: { name: string }) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(out.axes).toContainEqual({ axis: "arrivals", available: false });
    expect(out.axes).toContainEqual({ axis: "barrierFree", available: true });
    expect(out.tools.find((t: { name: string }) => t.name === "search_places")).toMatchObject({ available: true, produces: "ref" });
    expect(out.notes).toHaveLength(5);
    expect(out.notes.some((n: string) => n.includes("One tool runs at a time"))).toBe(true);
    expect(out.currentView).toBe("home");
  });
});
