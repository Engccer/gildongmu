import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChatModelSession } from "@/lib/chat/model-loop";

/**
 * E89 정식판 봉인의 byte-identical 고정: `chatModel`이 없거나 모르는 값이면 Gemini 호출 인자와 응답 바이트가 종전과 같다.
 * 실제 `runAgentLoop`를 돌리고(목하지 않는다) Gemini SDK만 가짜로 둔다.
 */
const calls = vi.hoisted(() => ({ gemini: [] as unknown[] }));
vi.mock("@/lib/gemini/client", () => ({
  GEMINI_MODEL: "gemini-test",
  getGeminiClient: () => ({
    models: {
      generateContent: async (req: unknown) => {
        calls.gemini.push(structuredClone(req));
        return { text: "제미니 답", candidates: [{ content: { role: "model", parts: [{ text: "제미니 답" }] } }] };
      },
    },
  }),
}));
vi.mock("@/lib/chat/declarations", () => ({
  availableDeclarations: () => [{ name: "get_weather", parametersJsonSchema: { type: "object", properties: {} } }],
}));
vi.mock("@/lib/rate-limit", () => ({ checkChatRateLimit: () => true, clientIpFromHeaders: () => "1.2.3.4" }));

const other = vi.hoisted(() => ({
  available: ["openai", "openai-luna", "claude-opus", "claude-sonnet", "claude-haiku"] as string[],
  budget: true,
  session: null as ChatModelSession | null,
  created: [] as { id: string; systemInstruction: string; history: unknown }[],
}));
vi.mock("@/lib/chat/chat-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/chat-models")>();
  return {
    ...actual,
    availableChatModels: () => other.available,
    reserveChatModelDaily: () => other.budget,
    createChatModelSession: (input: { id: string; systemInstruction: string; history: unknown }) => {
      other.created.push({ id: input.id, systemInstruction: input.systemInstruction, history: input.history });
      return other.session;
    },
  };
});

import { POST } from "../route";

function post(body: Record<string, unknown>) {
  return POST(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(body) }));
}
const base = { messages: [{ role: "user", text: "날씨 어때?" }], locale: "ko", userLocation: { lat: 37.5, lng: 127 } };

beforeEach(() => {
  calls.gemini = [];
  other.created = [];
  other.available = ["openai", "openai-luna", "claude-opus", "claude-sonnet", "claude-haiku"];
  other.budget = true;
  other.session = null;
});

describe("/api/chat chatModel 봉인 (E89)", () => {
  it("값 없음·모르는 값은 Gemini 호출 인자와 응답 바이트가 같다(byte-identical)", async () => {
    const ref = await (await post(base)).text();
    const refCalls = calls.gemini;
    expect(refCalls).toHaveLength(1);
    expect(ref).toBe(`${JSON.stringify({ type: "done", text: "제미니 답", renders: [], sources: [] })}\n`);
    for (const v of ["gemini", "google", "OPENAI", " openai", "", 123, null, true, { id: "openai" }, ["openai"]]) {
      calls.gemini = [];
      const raw = await (await post({ ...base, chatModel: v })).text();
      expect(raw, `chatModel=${JSON.stringify(v)}`).toBe(ref);
      expect(calls.gemini, `chatModel=${JSON.stringify(v)}`).toEqual(refCalls);
    }
    expect(other.created).toEqual([]);
  });

  it("알려진 값은 그 회사 세션으로 가고 Gemini를 부르지 않는다. 지침·이력은 같은 재료", async () => {
    other.session = { round: async () => ({ text: "테라 답", calls: [] }), addToolResults: () => {} };
    const raw = await (await post({ ...base, chatModel: "openai" })).text();
    expect(JSON.parse(raw.trim())).toEqual({ type: "done", text: "테라 답", renders: [], sources: [] });
    expect(calls.gemini).toEqual([]);
    expect(other.created[0].id).toBe("openai");
    expect(other.created[0].history).toEqual(base.messages);
    // 지침은 Gemini 경로와 같은 정본(`buildChatSystemInstruction`)이다.
    await post(base);
    const geminiSystem = (calls.gemini[0] as { config: { systemInstruction: string } }).config.systemInstruction;
    expect(other.created[0].systemInstruction).toBe(geminiSystem);
  });

  it("키 없는 알려진 값은 502 chat_model_unavailable(Gemini로 돌리지 않는다)", async () => {
    other.available = ["openai"];
    const res = await post({ ...base, chatModel: "claude-opus" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "chat_model_unavailable" });
    expect(calls.gemini).toEqual([]);
  });

  it("하루 상한이면 503 daily_budget_exhausted", async () => {
    other.session = { round: async () => ({ text: "x", calls: [] }), addToolResults: () => {} };
    other.budget = false;
    const res = await post({ ...base, chatModel: "claude-haiku" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "daily_budget_exhausted" });
  });

  it("Terra(`openai`)는 하루 상한이 다 차도 답한다(E92 A5: 정식판 처음 값은 상한 밖)", async () => {
    other.session = { round: async () => ({ text: "테라 답", calls: [] }), addToolResults: () => {} };
    other.budget = false;
    const res = await post({ ...base, chatModel: "openai" });
    expect(res.status).toBe(200);
    expect(JSON.parse((await res.text()).trim())).toEqual({ type: "done", text: "테라 답", renders: [], sources: [] });
  });

  it("모델 실패(402 등)는 기존 chat_failed이고 로그에 질문 글을 싣지 않는다", async () => {
    const { ChatModelError } = await import("@/lib/chat/chat-model-error");
    other.session = {
      round: async () => {
        throw new ChatModelError("openai responses", 402);
      },
      addToolResults: () => {},
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = await (await post({ ...base, chatModel: "openai-luna" })).text();
    expect(JSON.parse(raw.trim())).toEqual({ type: "error", code: "chat_failed" });
    expect(calls.gemini).toEqual([]);
    const logged = spy.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("openai responses 402");
    expect(logged).not.toContain("날씨");
    spy.mockRestore();
  });
});

describe("GET /api/chat/models", () => {
  it("키 있는 모델만, no-store", async () => {
    vi.doMock("next/server", () => ({ connection: async () => {} }));
    const { GET } = await import("../models/route");
    other.available = ["claude-opus"];
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ models: ["claude-opus"] });
  });
});
