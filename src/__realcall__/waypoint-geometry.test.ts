// 실호출 게이트(수동 실행): `REALCALL=1 npx vitest run src/__realcall__/waypoint-geometry.test.ts`
// dev 서버(3457)가 떠 있어야 한다. 기본은 skip — 게이트 테스트 레인에 섞이지 않는다.
import { describe, expect, it } from "vitest";
import { buildGuideRoute } from "@/lib/route-geometry";
import { buildCarGuide } from "@/lib/car-route-guide";
import type { CarRouteBriefing, WalkRouteBriefing } from "@/lib/types";

const B = process.env.REALCALL_BASE ?? "http://localhost:3457/api/route";
const Q = "origin=37.5386,127.1237&dest=37.5272,127.1268&via=37.5353,127.1323&includeGeometry=1";

describe.skipIf(!process.env.REALCALL)("경유지 기하 응답이 안내 조립을 통과한다", () => {
  it("walk(카카오)", async () => {
    const body = (await (await fetch(`${B}/walk?${Q}`)).json()) as { result: WalkRouteBriefing };
    expect(body.result.waypoint).toBeDefined();
    expect(buildGuideRoute(body.result.steps)).not.toBeNull();
  });
  it("walk shortest(E42: 카카오 SHORTEST, 폴백 Tmap 10)", async () => {
    const body = (await (await fetch(`${B}/walk?${Q}&variant=shortest`)).json()) as { result: WalkRouteBriefing };
    expect(body.result.waypoint).toBeDefined();
    expect(body.result.kind).toBe("shortest");
    expect(buildGuideRoute(body.result.steps)).not.toBeNull();
  });
  it("walk 계단 회피(ACCESSIBLE) — 경유지 legs 2 가드 통과 또는 큰길로 내려감", async () => {
    const body = (await (await fetch(`${B}/walk?${Q}&accessible=true`)).json()) as { result: WalkRouteBriefing };
    expect(body.result.waypoint).toBeDefined();
    expect(buildGuideRoute(body.result.steps)).not.toBeNull();
  });
  it("car(Tmap)", async () => {
    const body = (await (await fetch(`${B}/car?${Q}`)).json()) as CarRouteBriefing;
    expect(body.waypoint).toBeDefined();
    expect(buildCarGuide(body)).not.toBeNull();
  });
});
