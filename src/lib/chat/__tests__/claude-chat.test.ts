import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createClaudeChatSession, type ClaudeChatClientLike } from "../claude-chat";

function message(partial: Partial<Anthropic.Message>): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "x", content: [], stop_reason: "end_turn", usage: {}, ...partial } as Anthropic.Message;
}

function fakeClient(responses: Anthropic.Message[]) {
  const params: Anthropic.MessageStreamParams[] = [];
  const client: ClaudeChatClientLike = {
    messages: {
      stream(p) {
        // 회차 사이에 배열이 자라도 기록이 바뀌지 않게 깊은 복사한다.
        params.push(structuredClone(p));
        const m = responses.shift()!;
        return { finalMessage: async () => m };
      },
    },
  };
  return { client, params };
}

const tools: Anthropic.Tool[] = [{ name: "get_weather", input_schema: { type: "object", properties: {} } }];

describe("createClaudeChatSession (E89 C7)", () => {
  it("Sonnet 설정: between_tools + effort low, 캐시 지점 둘, 도구 선택 auto→none, 생각 블록째 append, 실패 결과는 is_error", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" } as unknown as Anthropic.ContentBlock;
    const { client, params } = fakeClient([
      message({
        stop_reason: "tool_use",
        content: [thinking, { type: "tool_use", id: "t1", name: "get_weather", input: { place: "강남" } } as Anthropic.ToolUseBlock],
      }),
      message({ content: [{ type: "text", text: "맑음" } as Anthropic.TextBlock] }),
    ]);
    const s = createClaudeChatSession({
      client,
      model: "claude-sonnet-5-5",
      settings: { thinking: { type: "between_tools" } as Anthropic.ThinkingConfigParam, effort: "low" },
      system: "지침",
      tools,
      history: [
        { role: "assistant", text: "앞머리 인사" },
        { role: "user", text: "날씨?" },
        { role: "assistant", text: "" },
      ],
    });
    const r1 = await s.round(true);
    expect(r1.calls).toEqual([{ id: "t1", name: "get_weather", args: { place: "강남" } }]);
    s.addToolResults([{ call: r1.calls[0], ok: false, response: { error: "x" } }]);
    expect((await s.round(false)).text).toBe("맑음");

    expect(params[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      tool_choice: { type: "auto" },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: "지침", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "날씨?" }],
    });
    expect(params[1].tool_choice).toEqual({ type: "none" });
    expect(params[1].messages).toEqual([
      { role: "user", content: "날씨?" },
      { role: "assistant", content: [thinking, { type: "tool_use", id: "t1", name: "get_weather", input: { place: "강남" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"error":"x"}', is_error: true }] },
    ]);
  });

  it("Opus·Haiku 설정은 thinking을 보내지 않는다", async () => {
    const { client, params } = fakeClient([message({ content: [{ type: "text", text: "a" } as Anthropic.TextBlock] })]);
    const s = createClaudeChatSession({ client, model: "claude-opus-5-5", settings: { effort: "low" }, system: "", tools, history: [{ role: "user", text: "q" }] });
    await s.round(true);
    expect("thinking" in params[0]).toBe(false);
  });

  it("stop_reason이 end_turn·tool_use 밖이면 실패(refusal·max_tokens)", async () => {
    for (const stop of ["refusal", "max_tokens"] as const) {
      const { client } = fakeClient([message({ stop_reason: stop })]);
      const s = createClaudeChatSession({ client, model: "m", settings: { effort: "low" }, system: "", tools, history: [{ role: "user", text: "q" }] });
      await expect(s.round(true)).rejects.toMatchObject({ kind: `claude stop ${stop}` });
    }
  });
});
