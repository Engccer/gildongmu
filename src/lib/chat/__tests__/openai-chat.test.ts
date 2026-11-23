import { describe, expect, it, vi } from "vitest";
import type { FunctionDeclaration } from "@google/genai";
import { createOpenAiChatSession, toOpenAiChatTools } from "../openai-chat";
import { ChatModelError } from "../chat-model-error";

const decl: FunctionDeclaration = {
  name: "get_weather",
  description: "날씨",
  parametersJsonSchema: { type: "object", properties: { place: { type: "string" } } },
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("toOpenAiChatTools", () => {
  it("스키마를 깊은 복사로 그대로 옮기고 strict:false를 명시한다", () => {
    const [t] = toOpenAiChatTools([decl]);
    expect(t).toEqual({ type: "function", name: "get_weather", description: "날씨", parameters: decl.parametersJsonSchema, strict: false });
    expect(t.parameters).not.toBe(decl.parametersJsonSchema);
  });
  it("Gemini Type 스키마(parameters)는 throw", () => {
    expect(() => toOpenAiChatTools([{ name: "x", parameters: { type: "OBJECT" } } as unknown as FunctionDeclaration])).toThrow();
  });
});

describe("createOpenAiChatSession (E89 C7)", () => {
  it("요청 모양: store:false, 추론 끔이면 include 없음, 이력은 append-only, 도구 결과는 call_id 짝", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? okResponse({
            status: "completed",
            output: [{ type: "function_call", call_id: "c1", name: "get_weather", arguments: '{"place":"강남"}' }],
          })
        : okResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "맑음" }] }] });
    }) as unknown as typeof fetch;
    const s = createOpenAiChatSession({
      apiKey: "k",
      model: "gpt-6.1-terra",
      effort: "none",
      instructions: "지침",
      tools: toOpenAiChatTools([decl]),
      history: [
        { role: "user", text: "날씨?" },
        { role: "assistant", text: "" },
      ],
      fetchImpl,
    });
    const r1 = await s.round(true);
    expect(r1.calls).toEqual([{ id: "c1", name: "get_weather", args: { place: "강남" } }]);
    s.addToolResults([{ call: r1.calls[0], ok: true, response: { sky: "clear" } }]);
    const r2 = await s.round(false);
    expect(r2.text).toBe("맑음");

    expect(bodies[0]).toMatchObject({
      model: "gpt-6.1-terra",
      instructions: "지침",
      store: false,
      tool_choice: "auto",
      reasoning: { effort: "none" },
      input: [{ role: "user", content: "날씨?" }],
    });
    expect(bodies[0].include).toBeUndefined();
    expect(bodies[1].tool_choice).toBe("none");
    expect(bodies[1].input).toEqual([
      { role: "user", content: "날씨?" },
      { type: "function_call", call_id: "c1", name: "get_weather", arguments: '{"place":"강남"}' },
      { type: "function_call_output", call_id: "c1", output: '{"sky":"clear"}' },
    ]);
  });

  it("추론 켠 설정(Luna 낮음)은 암호화 추론 항목을 받는다", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return okResponse({ status: "completed", output: [] });
    }) as unknown as typeof fetch;
    const s = createOpenAiChatSession({ apiKey: "k", model: "gpt-6-luna", effort: "low", instructions: "", tools: [], history: [{ role: "user", text: "q" }], fetchImpl });
    await s.round(true);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("실패 갈래: HTTP 402, incomplete, refusal은 ChatModelError(본문을 싣지 않는다)", async () => {
    const mk = (res: Response) =>
      createOpenAiChatSession({
        apiKey: "k", model: "m", effort: "none", instructions: "", tools: [], history: [{ role: "user", text: "q" }],
        fetchImpl: (async () => res) as unknown as typeof fetch,
      });
    await expect(mk(new Response("질문 글이 되비친 본문", { status: 402 })).round(true)).rejects.toMatchObject({ kind: "openai responses", status: 402 });
    await expect(mk(okResponse({ status: "incomplete" })).round(true)).rejects.toMatchObject({ kind: "openai incomplete" });
    const refusal = mk(okResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }));
    await expect(refusal.round(true)).rejects.toBeInstanceOf(ChatModelError);
    try {
      await mk(new Response("질문 글이 되비친 본문", { status: 500 })).round(true);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("질문");
    }
  });
});
