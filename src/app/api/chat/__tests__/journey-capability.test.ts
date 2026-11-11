// E70-b D7·§4.4 — /api/chat의 능력 신고: `"journey"` ∧ ko ∧ 키 셋일 때만 선언·지침·실행 컨텍스트가 열린다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentLoopOptions } from "@/lib/chat/agent-loop";

vi.mock("@/lib/gemini/client", () => ({ getGeminiClient: vi.fn(() => ({})), GEMINI_MODEL: "m" }));
vi.mock("@/lib/rate-limit", () => ({ checkChatRateLimit: () => true, clientIpFromHeaders: () => "9.8.7.6" }));
vi.mock("@/lib/chat/agent-loop", () => ({
  runAgentLoop: vi.fn(async () => ({ text: "답", renders: [], sources: [] })),
}));
vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  hasOdsayKey: vi.fn(() => true),
  hasTmapKey: vi.fn(() => true),
  hasKakaoKey: vi.fn(() => true),
}));

import { POST } from "../route";
import { runAgentLoop } from "@/lib/chat/agent-loop";
import { hasTmapKey } from "@/lib/env";

const SEOUL = { lat: 37.5665, lng: 126.978 };

async function send(body: Record<string, unknown>): Promise<AgentLoopOptions> {
  vi.mocked(runAgentLoop).mockClear();
  const res = await POST(
    new Request("http://x/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", text: "q" }], userLocation: SEOUL, ...body }),
    }),
  );
  await res.text();
  return vi.mocked(runAgentLoop).mock.calls[0][0];
}

const toolNames = (o: AgentLoopOptions) => o.tools[0].functionDeclarations.map((d) => d.name);

describe("POST /api/chat — 능력 신고(E70-b)", () => {
  beforeEach(() => {
    vi.mocked(hasTmapKey).mockReturnValue(true);
  });

  it("capabilities가 없으면 plan_journey 선언·지침·ctx.journey가 전부 없다(종전과 동일)", async () => {
    const o = await send({ locale: "ko" });
    expect(toolNames(o)).not.toContain("plan_journey");
    expect(o.systemInstruction).not.toContain("plan_journey");
    expect(o.ctx).not.toHaveProperty("journey");
    expect(o.ctx).toEqual({ userLocation: SEOUL, placeAnchor: undefined, locale: "ko", dataLocale: "ko" });
  });

  it('"journey" 신고 + ko + 키 셋이면 선언·지침이 열리고 ctx.journey에 IP와 새 턴 상태가 실린다', async () => {
    const o = await send({ locale: "ko", capabilities: ["journey"] });
    expect(toolNames(o)).toContain("plan_journey");
    expect(o.systemInstruction).toContain("plan_journey");
    expect(o.ctx.journey).toEqual({ clientIp: "9.8.7.6", manualOrigin: false, turn: { asked: false, queried: false } });
  });

  it("locale 누락은 ko다", async () => {
    const o = await send({ capabilities: ["journey"] });
    expect(o.ctx.journey).toBeDefined();
  });

  it("수동 위치(userLocationManual)면 manualOrigin: true", async () => {
    const o = await send({ locale: "ko", capabilities: ["journey"], userLocationManual: true });
    expect(o.ctx.journey?.manualOrigin).toBe(true);
  });

  it("ko가 아닌 로케일의 신고는 버린다", async () => {
    const o = await send({ locale: "en", capabilities: ["journey"] });
    expect(toolNames(o)).not.toContain("plan_journey");
    expect(o.systemInstruction).not.toContain("plan_journey");
    expect(o.ctx).not.toHaveProperty("journey");
  });

  it("키가 하나라도 없으면 신고해도 열리지 않는다", async () => {
    vi.mocked(hasTmapKey).mockReturnValue(false);
    const o = await send({ locale: "ko", capabilities: ["journey"] });
    expect(toolNames(o)).not.toContain("plan_journey");
    expect(o.ctx).not.toHaveProperty("journey");
  });

  it("모르는 값·배열이 아닌 값은 무시한다", async () => {
    for (const capabilities of [["teleport"], "journey", { journey: true }, null]) {
      const o = await send({ locale: "ko", capabilities });
      expect(toolNames(o), JSON.stringify(capabilities)).not.toContain("plan_journey");
      expect(o.ctx).not.toHaveProperty("journey");
    }
    const mixed = await send({ locale: "ko", capabilities: ["teleport", "journey"] });
    expect(toolNames(mixed)).toContain("plan_journey");
  });

  it("요청마다 턴 상태가 새로 만들어진다(턴과 수명이 같다)", async () => {
    const a = await send({ locale: "ko", capabilities: ["journey"] });
    a.ctx.journey!.turn.queried = true;
    const b = await send({ locale: "ko", capabilities: ["journey"] });
    expect(b.ctx.journey!.turn).toEqual({ asked: false, queried: false });
  });
});
