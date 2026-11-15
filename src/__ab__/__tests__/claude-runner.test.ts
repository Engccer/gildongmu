/**
 * Claude A/B 러너 게이트 테스트(가짜 SDK, 실호출 0). 모델 외 변수가 섞이지 않는지를 본다:
 * 도구 변환이 설명·enum·required를 잃지 않는가, 루프 상한·I-2 폴백이 Gemini 루프와 같은가,
 * 정지 사유 refusal·max_tokens가 실패로 남는가, 캐시 usage가 비용에 맞게 합산되는가.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

vi.mock("@/lib/chat/router", () => ({
  executeFunction: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "fail_tool") throw new Error("provider 폭발");
    return { data: { ok: true, name, args }, render: { type: "air-quality" }, source: [{ label: "s" }] };
  }),
}));

import {
  ClaudeStopError,
  parseClaudeSpec,
  runClaudeAgentLoop,
  toAnthropicTools,
  type ClaudeClientLike,
  type ClaudeLoopOptions,
  type ClaudeLoopTrace,
} from "../claude-runner";
import { pricesAt, sessionCost, type RunResult } from "../report";

type Block = Anthropic.ContentBlock;

function msg(content: Block[], stop: Anthropic.StopReason, usage: Partial<Anthropic.Usage> = {}, category?: string): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: category ? ({ type: "refusal", category, explanation: null } as unknown as Anthropic.RefusalStopDetails) : null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens_details: null,
      ...usage,
    } as Anthropic.Usage,
  } as unknown as Anthropic.Message;
}
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
const thinking = () => ({ type: "thinking", thinking: "", signature: "sig" }) as unknown as Block;
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) =>
  ({ type: "tool_use", id, name, input, caller: { type: "direct" } }) as unknown as Block;

/** 응답 스크립트를 순서대로 돌려주고, 받은 요청을 깊은 복사로 남기는 가짜 SDK. */
function fakeClient(script: Anthropic.Message[]) {
  const calls: Anthropic.MessageStreamParams[] = [];
  let i = 0;
  const client: ClaudeClientLike = {
    messages: {
      stream(params) {
        calls.push(structuredClone(params));
        const m = script[Math.min(i++, script.length - 1)];
        const listeners: ((d: string) => void)[] = [];
        const events: (() => void)[] = [];
        return {
          on(e: "text" | "streamEvent", l: ((d: string) => void) | (() => void)) {
            if (e === "text") listeners.push(l as (d: string) => void);
            else events.push(l as () => void);
            return this;
          },
          async finalMessage() {
            events.forEach((l) => l());
            for (const b of m.content) if (b.type === "text") listeners.forEach((l) => l(b.text));
            return m;
          },
        } as ReturnType<ClaudeClientLike["messages"]["stream"]>;
      },
    },
  };
  return { client, calls };
}

const TOOLS: Anthropic.Tool[] = [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }];

function opts(client: ClaudeClientLike, spec = "claude-opus-5-5@low"): ClaudeLoopOptions {
  return {
    client,
    spec: parseClaudeSpec(spec),
    systemInstruction: "SYS",
    tools: TOOLS,
    turns: ["질문"],
    ctx: { locale: "ko", dataLocale: "ko" } as unknown as ClaudeLoopOptions["ctx"],
  };
}
const newTrace = (): ClaudeLoopTrace => ({ rounds: [], toolOutputs: [] });

describe("parseClaudeSpec", () => {
  it("effort와 between_tools를 가른다", () => {
    expect(parseClaudeSpec("claude-opus-5-5@low")).toEqual({ model: "claude-opus-5-5", effort: "low", betweenTools: false });
    expect(parseClaudeSpec("claude-sonnet-5-5@low+between_tools")).toEqual({ model: "claude-sonnet-5-5", effort: "low", betweenTools: true });
    expect(parseClaudeSpec("claude-opus-5-5")).toEqual({ model: "claude-opus-5-5", effort: null, betweenTools: false });
  });
  it("오타·허용되지 않는 조합은 돈을 쓰기 전에 throw", () => {
    expect(() => parseClaudeSpec("claude-opus-5-5@lo")).toThrow();
    expect(() => parseClaudeSpec("claude-sonnet-5-5@low+betweentools")).toThrow();
    expect(() => parseClaudeSpec("claude-sonnet-5-5@max+between_tools")).toThrow();
  });
});

describe("runClaudeAgentLoop 요청 모양", () => {
  it("system·자동 캐시 지점, tool_choice auto, effort만 싣고 thinking·fallbacks·temperature는 보내지 않는다", async () => {
    const { client, calls } = fakeClient([msg([thinking(), text("답")], "end_turn")]);
    const r = await runClaudeAgentLoop(opts(client), newTrace());
    expect(r.text).toBe("답");
    expect(calls).toHaveLength(1);
    const p = calls[0] as unknown as Record<string, unknown>;
    expect(p.system).toEqual([{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } }]);
    expect(p.cache_control).toEqual({ type: "ephemeral" });
    expect(p.tool_choice).toEqual({ type: "auto" });
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.tools).toEqual(TOOLS);
    for (const k of ["thinking", "fallbacks", "temperature", "betas"]) expect(p).not.toHaveProperty(k);
  });

  it("between_tools 표기면 thinking에 그 값만 싣는다", async () => {
    const { client, calls } = fakeClient([msg([text("답")], "end_turn")]);
    await runClaudeAgentLoop(opts(client, "claude-sonnet-5-5@low+between_tools"), newTrace());
    expect((calls[0] as unknown as Record<string, unknown>).thinking).toEqual({ type: "between_tools" });
    expect(calls[0].model).toBe("claude-sonnet-5-5");
  });
});

describe("runClaudeAgentLoop 도구 왕복", () => {
  it("assistant 내용(생각 블록 포함)을 그대로 붙이고 tool_result를 한 user 메시지로 돌려준다", async () => {
    const first = msg([thinking(), toolUse("u1", "t", { place: "길동" }), toolUse("u2", "fail_tool")], "tool_use");
    const { client, calls } = fakeClient([first, msg([text("최종")], "end_turn")]);
    const trace = newTrace();
    const r = await runClaudeAgentLoop(opts(client), trace);
    expect(r.text).toBe("최종");
    expect(calls).toHaveLength(2);
    const second = calls[1].messages;
    expect(second[1]).toEqual({ role: "assistant", content: first.content });
    const results = second[2].content as Anthropic.ToolResultBlockParam[];
    expect(second[2].role).toBe("user");
    expect(results.map((b) => b.tool_use_id)).toEqual(["u1", "u2"]);
    expect(JSON.parse(results[0].content as string)).toEqual({ ok: true, name: "t", args: { place: "길동" } });
    expect(results[0].is_error).toBeUndefined();
    expect(JSON.parse(results[1].content as string)).toEqual({ error: "Error: provider 폭발" });
    expect(results[1].is_error).toBe(true);
    // 채점기 입력: 도구 반환 원문(실패는 { error })
    expect(trace.toolOutputs).toEqual([
      { name: "t", response: { ok: true, name: "t", args: { place: "길동" } } },
      { name: "fail_tool", response: { error: "Error: provider 폭발" } },
    ]);
    expect(trace.rounds[0].toolCalls).toEqual(["t", "fail_tool"]);
    expect(trace.rounds[0].toolArgs[0]).toEqual({ name: "t", args: { place: "길동" } });
    expect(r.renders).toHaveLength(1);
    expect(r.sources).toBe(1);
    // 앞 요청의 messages가 뒤에서 바뀌지 않는다(append-only)
    expect(calls[0].messages).toEqual([{ role: "user", content: "질문" }]);
  });

  it("Gemini 루프와 같은 상한: 도구 6회차까지 실행하고, 7번째 tool_use는 실행하지 않은 채 tool_choice none으로 1회 더", async () => {
    const tu = msg([toolUse("u", "t")], "tool_use");
    const { client, calls } = fakeClient([tu, tu, tu, tu, tu, tu, tu, msg([text("마무리")], "end_turn")]);
    const trace = newTrace();
    const r = await runClaudeAgentLoop(opts(client), trace);
    expect(trace.toolOutputs).toHaveLength(6);
    expect(calls).toHaveLength(8);
    expect(calls[7].tool_choice).toEqual({ type: "none" });
    expect(calls[7].tools).toEqual(TOOLS); // 선언 목록은 그대로(접두 불변)
    const last = calls[7].messages;
    expect(last[last.length - 1].role).toBe("user"); // 실행 안 한 7번째 tool_use는 기록에 없다
    expect(r.text).toBe("마무리");
  });

  it("첫 글자는 반환한 답 회차의 첫 text 델타다(앞 도구 회차의 글은 세지 않는다), 글이 없으면 undefined", async () => {
    let clock = 1000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (clock += 10));
    try {
      const { client } = fakeClient([msg([text("잠시만요"), toolUse("u", "t")], "tool_use"), msg([text("답")], "end_turn")]);
      const trace = newTrace();
      const r = await runClaudeAgentLoop(opts(client), trace);
      const [first, last] = trace.rounds;
      expect(first.firstTextMs).not.toBeNull();
      expect(r.ttftMs).toBe(last.startedAt + last.firstTextMs!);
      expect(r.ttftMs!).toBeGreaterThan(first.startedAt + first.firstTextMs!);

      const silent = fakeClient([msg([thinking()], "end_turn")]);
      expect((await runClaudeAgentLoop(opts(silent.client), newTrace())).ttftMs).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("마지막 답이 비면 tool_choice none으로 1회 더 부른다(I-2)", async () => {
    const { client, calls } = fakeClient([msg([thinking()], "end_turn"), msg([text("산문")], "end_turn")]);
    const r = await runClaudeAgentLoop(opts(client), newTrace());
    expect(calls[1].tool_choice).toEqual({ type: "none" });
    expect(calls[1].messages).toEqual([{ role: "user", content: "질문" }]);
    expect(r.text).toBe("산문");
  });
});

describe("runClaudeAgentLoop 실패 정지", () => {
  it("refusal은 ClaudeStopError(범주 포함)이고 trace에 그 회차가 남는다", async () => {
    const { client } = fakeClient([msg([], "refusal", {}, "bio")]);
    const trace = newTrace();
    await expect(runClaudeAgentLoop(opts(client), trace)).rejects.toThrow(ClaudeStopError);
    expect(trace.rounds).toHaveLength(1);
    expect(trace.rounds[0].stopReason).toBe("refusal");
    await expect(runClaudeAgentLoop(opts(fakeClient([msg([], "refusal", {}, "bio")]).client), newTrace())).rejects.toThrow("category=bio");
  });

  it("max_tokens는 글이 있어도 실패다(잘린 답을 채점하지 않는다)", async () => {
    const { client } = fakeClient([msg([text("잘린")], "max_tokens")]);
    await expect(runClaudeAgentLoop(opts(client), newTrace())).rejects.toThrow("stop_reason=max_tokens");
  });

  it("도구 회차 뒤의 refusal도 실패다", async () => {
    const { client } = fakeClient([msg([toolUse("u", "t")], "tool_use"), msg([], "refusal")]);
    const trace = newTrace();
    await expect(runClaudeAgentLoop(opts(client), trace)).rejects.toThrow("stop_reason=refusal");
    expect(trace.toolOutputs).toHaveLength(1);
  });
});

describe("usage 합산과 비용", () => {
  it("캐시 읽기·쓰기를 입력 총량에 넣고, 생각 토큰을 출력에서 가른다", async () => {
    const u1 = { input_tokens: 50, cache_creation_input_tokens: 8000, cache_read_input_tokens: 0, output_tokens: 300, output_tokens_details: { thinking_tokens: 200 } };
    const u2 = { input_tokens: 400, cache_creation_input_tokens: 600, cache_read_input_tokens: 8000, output_tokens: 120, output_tokens_details: null };
    const { client } = fakeClient([
      msg([toolUse("u", "t")], "tool_use", u1 as Partial<Anthropic.Usage>),
      msg([text("답")], "end_turn", u2 as Partial<Anthropic.Usage>),
    ]);
    const trace = newTrace();
    await runClaudeAgentLoop(opts(client), trace);
    expect(trace.rounds.map((r) => [r.promptTokens, r.cacheWriteTokens, r.cacheReadTokens, r.outputTokens, r.thoughtTokens])).toEqual([
      [8050, 8000, 0, 100, 200],
      [9000, 600, 8000, 120, 0],
    ]);
  });

  it("Opus 5.5 비용: 비캐시 $4, 캐시 쓰기 $5, 캐시 읽기 $0.20, 출력(생각 포함) $20 per 1M", () => {
    const r = { promptTokens: 17_050, cacheWriteTokens: 8_600, cacheReadTokens: 8_000, outputTokens: 220, thoughtTokens: 200 } as RunResult;
    const p = pricesAt("2026-11-14T00:00:00.000Z", "claude-opus-5-5@low");
    const expected = (450 * 4 + 8_600 * 5 + 8_000 * 0.2 + 420 * 20) / 1e6;
    expect(sessionCost(r, p)).toBeCloseTo(expected, 10);
    expect(p.label).not.toContain("미등록");
    expect(pricesAt("2026-11-14T00:00:00.000Z", "claude-sonnet-5-5@low+between_tools").cacheReadPerToken).toBeCloseTo(0.1 / 1e6, 15);
  });

  it("캐시 필드가 없는 결과(Gemini)는 종전과 같은 값", () => {
    const r = { promptTokens: 1000, outputTokens: 100, thoughtTokens: 50 } as RunResult;
    const p = pricesAt("2026-11-14T00:00:00.000Z", "gemini-3.6-flash");
    expect(sessionCost(r, p)).toBeCloseTo((1000 * 0.75 + 150 * 3.75) / 1e6, 12);
  });
});

describe("toAnthropicTools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("모든 키가 있을 때의 실제 선언 전부를 이름·설명·스키마(enum·required 포함) 그대로 옮긴다", async () => {
    for (const k of [
      "KAKAO_REST_API_KEY", "NAVER_LOCAL_CLIENT_ID", "NAVER_LOCAL_CLIENT_SECRET", "NCP_MAPS_CLIENT_ID", "NCP_MAPS_CLIENT_SECRET",
      "TOUR_API_KEY", "DATA_GO_KR_API_KEY", "SEOUL_OPEN_DATA_KEY", "SEOUL_SUBWAY_REALTIME_KEY", "ODSAY_API_KEY",
      "JUSO_CONFM_KEY", "TMAP_APP_KEY", "PERPLEXITY_API_KEY", "GOOGLE_PLACES_API_KEY",
    ]) vi.stubEnv(k, "x");
    const { availableDeclarations } = await import("@/lib/chat/declarations");
    const decls = availableDeclarations(new Set());
    const tools = toAnthropicTools(decls);
    expect(tools).toHaveLength(decls.length);
    expect(decls.length).toBeGreaterThanOrEqual(20);
    tools.forEach((t, i) => {
      expect(t.name).toBe(decls[i].name);
      expect(t.description).toBe(decls[i].description);
      expect(t.input_schema).toEqual(decls[i].parametersJsonSchema ?? { type: "object", properties: {} });
      expect(Object.keys(t).sort()).toEqual(["description", "input_schema", "name"]);
    });
    // enum이 실제로 실려 있는 선언이 있어야 이 비교가 enum 보존을 검사한다
    expect(JSON.stringify(tools)).toContain('"enum"');
    expect(JSON.stringify(tools)).toContain('"required"');
  });

  it("스키마는 깊은 복사다(변환 결과를 고쳐도 선언 원본이 바뀌지 않는다)", () => {
    const decl = { name: "a", description: "d", parametersJsonSchema: { type: "object", properties: { x: { type: "string", enum: ["p"] } }, required: ["x"] } };
    const [t] = toAnthropicTools([decl]);
    (t.input_schema.properties as Record<string, { enum: string[] }>).x.enum.push("q");
    expect(decl.parametersJsonSchema.properties.x.enum).toEqual(["p"]);
  });

  it("Gemini Type 스키마(parameters)는 조용히 버리지 않고 throw", () => {
    expect(() => toAnthropicTools([{ name: "a", parameters: { type: "OBJECT" } } as never])).toThrow("parameters");
  });
});
