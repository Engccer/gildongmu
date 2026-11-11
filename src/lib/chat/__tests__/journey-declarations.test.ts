// E70-b D7 — plan_journey 선언은 클라이언트 능력 신고 + 키 셋일 때만. 지침 단락도 그때만 실린다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const KEYS = ["KAKAO_REST_API_KEY", "ODSAY_API_KEY", "TMAP_APP_KEY", "DATA_GO_KR_API_KEY"] as const;
const JOURNEY = new Set(["journey"] as const);

async function load() {
  return import("../declarations");
}

describe("plan_journey 선언 게이트", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const k of KEYS) vi.stubEnv(k, "x");
  });

  it("능력 신고가 없으면 선언되지 않고, 목록은 여정을 뺀 것과 완전히 같다", async () => {
    const { availableDeclarations } = await load();
    const without = availableDeclarations(new Set());
    const withJourney = availableDeclarations(JOURNEY);
    expect(without.some((d) => d.name === "plan_journey")).toBe(false);
    expect(withJourney.filter((d) => d.name === "plan_journey")).toHaveLength(1);
    // 능력은 여정 하나만 더한다 — 나머지 선언은 순서·내용이 그대로다.
    expect(JSON.stringify(withJourney.filter((d) => d.name !== "plan_journey"))).toBe(JSON.stringify(without));
  });

  it("능력을 신고해도 키 셋(ODsay·Tmap·카카오) 중 하나라도 없으면 선언되지 않는다", async () => {
    for (const missing of ["ODSAY_API_KEY", "TMAP_APP_KEY", "KAKAO_REST_API_KEY"]) {
      vi.unstubAllEnvs();
      vi.resetModules();
      for (const k of KEYS) vi.stubEnv(k, k === missing ? undefined : "x");
      const { availableDeclarations } = await load();
      expect(availableDeclarations(JOURNEY).some((d) => d.name === "plan_journey"), missing).toBe(false);
    }
  });

  it("인자는 D1 그대로이고 필수는 destination뿐이다", async () => {
    const { availableDeclarations } = await load();
    const d = availableDeclarations(JOURNEY).find((x) => x.name === "plan_journey")!;
    const schema = d.parametersJsonSchema as { properties: Record<string, { enum?: string[] }>; required: string[] };
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["alight_kind", "alight_line", "alight_station", "board_kind", "board_line", "board_station", "destination", "transfer_side"].sort(),
    );
    expect(schema.required).toEqual(["destination"]);
    expect(schema.properties.transfer_side.enum).toEqual(["board", "alight"]);
    expect(schema.properties.board_kind.enum).toEqual(["station", "stop"]);
  });

  it("정류장 검색 키(data.go.kr)가 없으면 _kind 인자가 없다(부를 수 없는 인자를 선언하지 않는다)", async () => {
    vi.stubEnv("DATA_GO_KR_API_KEY", undefined);
    const { availableDeclarations } = await load();
    const d = availableDeclarations(JOURNEY).find((x) => x.name === "plan_journey")!;
    const props = (d.parametersJsonSchema as { properties: Record<string, unknown> }).properties;
    expect(props).not.toHaveProperty("board_kind");
    expect(props).not.toHaveProperty("alight_kind");
    expect(props).toHaveProperty("board_station");
  });
});

describe("시스템 지침 — 여정 단락은 도구가 선언될 때만", () => {
  it("journey: false면 종전 지침과 같고 plan_journey를 말하지 않는다", async () => {
    const { buildChatSystemInstruction } = await import("../system-instruction");
    const off = buildChatSystemInstruction("ko", undefined, { journey: false });
    const on = buildChatSystemInstruction("ko", undefined, { journey: true });
    expect(off).not.toContain("plan_journey");
    expect(on).toContain("plan_journey");
    expect(on).toContain("needStation");
    // 단락은 끝에 덧붙을 뿐이다 — 앞부분은 한 글자도 바뀌지 않는다.
    expect(on.startsWith(off)).toBe(true);
  });

  it("장소 컨텍스트 단락과 함께 실린다", async () => {
    const { buildChatSystemInstruction } = await import("../system-instruction");
    const s = buildChatSystemInstruction("ko", { name: "천호역" }, { journey: true });
    expect(s).toContain("[장소 컨텍스트]");
    expect(s).toContain("plan_journey");
  });
});
