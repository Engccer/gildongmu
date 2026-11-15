// E83 R2 — /api/chat의 `"route-start"` 능력 신고: 전 로케일에서 열리고 장소 채팅에는 닫힌다. 이 능력은 도구·지침을 바꾸지 않는다.
import { describe, it, expect, vi } from "vitest";
import type { AgentLoopOptions } from "@/lib/chat/agent-loop";
import { routing } from "@/i18n/routing";

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

describe("POST /api/chat — 능력 신고 route-start(E83)", () => {
  it("신고가 없으면 ctx에 routeStart 키가 없다(종전과 동일)", async () => {
    const o = await send({ locale: "ko" });
    expect(o.ctx).not.toHaveProperty("routeStart");
    expect(o.ctx).toEqual({ userLocation: SEOUL, placeAnchor: undefined, locale: "ko", dataLocale: "ko" });
  });

  it("여섯 로케일이 대상이다", () => {
    expect(routing.locales).toHaveLength(6);
  });

  it.each([...routing.locales])("%s: 신고하면 ctx.routeStart가 열린다(전 로케일)", async (locale) => {
    const o = await send({ locale, capabilities: ["route-start"] });
    expect(o.ctx.routeStart).toEqual({ manualOrigin: false });
  });

  it("수동 위치(userLocationManual)면 manualOrigin: true", async () => {
    const o = await send({ locale: "ko", capabilities: ["route-start"], userLocationManual: true });
    expect(o.ctx.routeStart).toEqual({ manualOrigin: true });
  });

  it("장소 상세에서 연 채팅(placeContext)은 신고해도 열리지 않는다", async () => {
    const o = await send({
      locale: "ko",
      capabilities: ["route-start", "journey"],
      placeContext: { name: "서울역", lat: 37.5547, lng: 126.9707 },
    });
    expect(o.ctx).not.toHaveProperty("routeStart");
    expect(o.ctx).not.toHaveProperty("journey");
  });

  it("이 능력은 선언 목록과 시스템 지침을 바꾸지 않는다(도구를 새로 열지 않는다)", async () => {
    const plain = await send({ locale: "ko" });
    const reported = await send({ locale: "ko", capabilities: ["route-start"] });
    expect(toolNames(reported)).toEqual(toolNames(plain));
    expect(reported.systemInstruction).toBe(plain.systemInstruction);
  });

  it("여정 신고와 서로 독립이다", async () => {
    const both = await send({ locale: "ko", capabilities: ["journey", "route-start"] });
    expect(both.ctx.journey).toBeDefined();
    expect(both.ctx.routeStart).toBeDefined();
    const journeyOnly = await send({ locale: "ko", capabilities: ["journey"] });
    expect(journeyOnly.ctx).not.toHaveProperty("routeStart");
    const startOnlyEn = await send({ locale: "en", capabilities: ["journey", "route-start"] });
    expect(startOnlyEn.ctx).not.toHaveProperty("journey");
    expect(startOnlyEn.ctx.routeStart).toBeDefined();
    expect(toolNames(startOnlyEn)).not.toContain("plan_journey");
  });

  it("모르는 값·배열이 아닌 값은 무시한다", async () => {
    for (const capabilities of [["teleport"], "route-start", { "route-start": true }, null]) {
      const o = await send({ locale: "ko", capabilities });
      expect(o.ctx, JSON.stringify(capabilities)).not.toHaveProperty("routeStart");
    }
  });
});
