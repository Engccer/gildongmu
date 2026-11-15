/**
 * OpenAI A/B 러너 게이트 테스트(가짜 호출, 실호출 0). 모델 외 변수가 섞이지 않는지를 본다:
 * 도구 변환이 설명·enum·required를 잃지 않고 strict를 끄는가, 루프 상한·I-2 폴백이 Gemini 루프와 같은가,
 * incomplete·refusal이 실패로 남는가, 캐시·추론 usage가 비용에 맞게 합산되는가.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/router", () => ({
  executeFunction: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "fail_tool") throw new Error("provider 폭발");
    return { data: { ok: true, name, args }, render: { type: "air-quality" }, source: [{ label: "s" }] };
  }),
}));

import {
  OpenAiStopError,
  parseOpenAiSpec,
  runOpenAiAgentLoop,
  toOpenAiTools,
  type OpenAiCall,
  type OpenAiFunctionTool,
  type OpenAiLoopOptions,
  type OpenAiLoopTrace,
  type OpenAiResponse,
} from "../openai-runner";
import { pricesAt, sessionCost, type RunResult } from "../report";

type Item = Record<string, unknown>;

function resp(output: Item[], status = "completed", usage: Partial<NonNullable<OpenAiResponse["usage"]>> = {}, reason?: string): OpenAiResponse {
  return {
    status,
    incomplete_details: reason ? { reason } : null,
    output,
    usage: { input_tokens: 100, output_tokens: 20, ...usage },
  };
}
const message = (t: string): Item => ({ type: "message", role: "assistant", content: [{ type: "output_text", text: t, annotations: [] }] });
const reasoning = (): Item => ({ type: "reasoning", id: "rs", summary: [], encrypted_content: "enc" });
const fnCall = (callId: string, name: string, args: Record<string, unknown> | string = {}): Item => ({
  type: "function_call",
  call_id: callId,
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});

/** 응답 스크립트를 순서대로 돌려주고, 받은 요청 본문을 깊은 복사로 남기는 가짜 호출. */
function fakeCall(script: OpenAiResponse[]) {
  const calls: Record<string, unknown>[] = [];
  let i = 0;
  const call: OpenAiCall = async (body) => {
    calls.push(structuredClone(body));
    return script[Math.min(i++, script.length - 1)];
  };
  return { call, calls };
}

const TOOLS: OpenAiFunctionTool[] = [{ type: "function", name: "t", description: "d", parameters: { type: "object", properties: {} }, strict: false }];

function opts(call: OpenAiCall, spec = "gpt-6.1-terra@none"): OpenAiLoopOptions {
  return {
    call,
    spec: parseOpenAiSpec(spec),
    systemInstruction: "SYS",
    tools: TOOLS,
    turns: ["질문"],
    ctx: { locale: "ko", dataLocale: "ko" } as unknown as OpenAiLoopOptions["ctx"],
  };
}
const newTrace = (): OpenAiLoopTrace => ({ rounds: [], toolOutputs: [] });

describe("parseOpenAiSpec", () => {
  it("모델과 reasoning effort를 가른다", () => {
    expect(parseOpenAiSpec("gpt-6.1-terra@none")).toEqual({ model: "gpt-6.1-terra", effort: "none" });
    expect(parseOpenAiSpec("gpt-6-luna@low")).toEqual({ model: "gpt-6-luna", effort: "low" });
    expect(parseOpenAiSpec("gpt-6-luna")).toEqual({ model: "gpt-6-luna", effort: null });
  });
  it("오타·모르는 접미사는 돈을 쓰기 전에 throw", () => {
    expect(() => parseOpenAiSpec("gpt-6-luna@lo")).toThrow();
    expect(() => parseOpenAiSpec("gpt-6-luna@low+between_tools")).toThrow();
  });
});

describe("runOpenAiAgentLoop 요청 모양", () => {
  it("instructions·tool_choice auto·병렬·저장 안 함·effort를 싣고, 추론 끔이면 include가 없다", async () => {
    const { call, calls } = fakeCall([resp([message("답")])]);
    const r = await runOpenAiAgentLoop(opts(call), newTrace());
    expect(r.text).toBe("답");
    expect(calls).toHaveLength(1);
    const b = calls[0];
    expect(b.model).toBe("gpt-6.1-terra");
    expect(b.instructions).toBe("SYS");
    expect(b.input).toEqual([{ role: "user", content: "질문" }]);
    expect(b.tool_choice).toBe("auto");
    expect(b.parallel_tool_calls).toBe(true);
    expect(b.store).toBe(false);
    expect(b.reasoning).toEqual({ effort: "none" });
    expect(b.tools).toEqual(TOOLS);
    for (const k of ["include", "temperature", "stream", "previous_response_id"]) expect(b).not.toHaveProperty(k);
  });

  it("추론을 켜면 암호화된 추론 항목을 받는다", async () => {
    const { call, calls } = fakeCall([resp([message("답")])]);
    await runOpenAiAgentLoop(opts(call, "gpt-6-luna@low"), newTrace());
    expect(calls[0].include).toEqual(["reasoning.encrypted_content"]);
    expect(calls[0].reasoning).toEqual({ effort: "low" });
  });

  it("effort 표기가 없으면 reasoning을 보내지 않는다(API 기본값)", async () => {
    const { call, calls } = fakeCall([resp([message("답")])]);
    await runOpenAiAgentLoop(opts(call, "gpt-6-luna"), newTrace());
    expect(calls[0]).not.toHaveProperty("reasoning");
  });
});

describe("runOpenAiAgentLoop 도구 왕복", () => {
  it("출력 항목(추론 포함)을 그대로 붙이고 call_id로 짝지은 function_call_output을 돌려준다", async () => {
    const first = resp([reasoning(), fnCall("c1", "t", { place: "길동" }), fnCall("c2", "fail_tool")]);
    const { call, calls } = fakeCall([first, resp([message("최종")])]);
    const trace = newTrace();
    const r = await runOpenAiAgentLoop(opts(call, "gpt-6-luna@low"), trace);
    expect(r.text).toBe("최종");
    expect(calls).toHaveLength(2);
    const input = calls[1].input as Item[];
    expect(input.slice(1, 4)).toEqual(first.output);
    expect(input.slice(4)).toEqual([
      { type: "function_call_output", call_id: "c1", output: JSON.stringify({ ok: true, name: "t", args: { place: "길동" } }) },
      { type: "function_call_output", call_id: "c2", output: JSON.stringify({ error: "Error: provider 폭발" }) },
    ]);
    // 채점기 입력: 도구 반환 원문(실패는 { error })
    expect(trace.toolOutputs).toEqual([
      { name: "t", response: { ok: true, name: "t", args: { place: "길동" } } },
      { name: "fail_tool", response: { error: "Error: provider 폭발" } },
    ]);
    expect(trace.rounds[0].toolCalls).toEqual(["t", "fail_tool"]);
    expect(trace.rounds[0].toolArgs[0]).toEqual({ name: "t", args: { place: "길동" } });
    expect(r.renders).toHaveLength(1);
    expect(r.sources).toBe(1);
    // 앞 요청의 input이 뒤에서 바뀌지 않는다(append-only)
    expect(calls[0].input).toEqual([{ role: "user", content: "질문" }]);
  });

  it("깨진 arguments는 빈 인자로 실행한다", async () => {
    const { call } = fakeCall([resp([fnCall("c", "t", "{깨짐")]), resp([message("답")])]);
    const trace = newTrace();
    await runOpenAiAgentLoop(opts(call), trace);
    expect(trace.toolOutputs[0].response).toEqual({ ok: true, name: "t", args: {} });
    expect(trace.rounds[0].brokenArgs).toBe(1);
    const ok = fakeCall([resp([fnCall("c", "t", ""), fnCall("d", "t", { a: 1 })]), resp([message("답")])]);
    const t2 = newTrace();
    await runOpenAiAgentLoop(opts(ok.call), t2);
    expect(t2.rounds[0].brokenArgs).toBe(0); // 빈 문자열은 깨짐이 아니라 빈 인자
  });

  it("Gemini 루프와 같은 상한: 도구 6회차까지 실행하고, 7번째 호출은 실행하지 않은 채 tool_choice none으로 1회 더", async () => {
    const fc = resp([fnCall("c", "t")]);
    const { call, calls } = fakeCall([fc, fc, fc, fc, fc, fc, fc, resp([message("마무리")])]);
    const trace = newTrace();
    const r = await runOpenAiAgentLoop(opts(call), trace);
    expect(trace.toolOutputs).toHaveLength(6);
    expect(calls).toHaveLength(8);
    expect(calls[7].tool_choice).toBe("none");
    expect(calls[7].tools).toEqual(TOOLS); // 선언 목록은 그대로
    const last = calls[7].input as Item[];
    expect(last[last.length - 1].type).toBe("function_call_output"); // 실행 안 한 7번째 호출은 이력에 없다
    expect(r.text).toBe("마무리");
  });

  it("마지막 답이 비면 tool_choice none으로 1회 더 부른다(I-2)", async () => {
    const { call, calls } = fakeCall([resp([reasoning()]), resp([message("산문")])]);
    const r = await runOpenAiAgentLoop(opts(call), newTrace());
    expect(calls[1].tool_choice).toBe("none");
    expect(calls[1].input).toEqual([{ role: "user", content: "질문" }]);
    expect(r.text).toBe("산문");
  });
});

describe("runOpenAiAgentLoop 실패 정지", () => {
  it("incomplete는 글이 있어도 실패이고(잘린 답을 채점하지 않는다) trace에 그 회차가 남는다", async () => {
    const { call } = fakeCall([resp([message("잘린")], "incomplete", {}, "max_output_tokens")]);
    const trace = newTrace();
    await expect(runOpenAiAgentLoop(opts(call), trace)).rejects.toThrow(OpenAiStopError);
    expect(trace.rounds).toHaveLength(1);
    expect(trace.rounds[0].status).toBe("incomplete");
    await expect(runOpenAiAgentLoop(opts(fakeCall([resp([], "incomplete", {}, "content_filter")]).call), newTrace())).rejects.toThrow(
      "content_filter",
    );
  });

  it("거절(refusal 내용)은 실패다", async () => {
    const refused = resp([{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "못 합니다" }] }]);
    await expect(runOpenAiAgentLoop(opts(fakeCall([refused]).call), newTrace())).rejects.toThrow("status=refusal");
  });

  it("output이 빠진 failed 응답도 TypeError가 아니라 실패 정지이고 그 회차가 trace에 남는다", async () => {
    const trace = newTrace();
    const noOutput = { status: "failed", error: { message: "server_error" }, usage: { input_tokens: 10, output_tokens: 0 } } as OpenAiResponse;
    await expect(runOpenAiAgentLoop(opts(fakeCall([noOutput]).call), trace)).rejects.toThrow(OpenAiStopError);
    expect(trace.rounds).toHaveLength(1);
    expect(trace.rounds[0].promptTokens).toBe(10);
  });

  it("도구 회차 뒤의 실패도 실패다", async () => {
    const { call } = fakeCall([resp([fnCall("c", "t")]), resp([], "failed")]);
    const trace = newTrace();
    await expect(runOpenAiAgentLoop(opts(call), trace)).rejects.toThrow("status=failed");
    expect(trace.toolOutputs).toHaveLength(1);
  });
});

describe("usage 합산과 비용", () => {
  it("입력 총량에 캐시 읽기·쓰기가 들어 있고, 추론 토큰을 출력에서 가른다", async () => {
    const u1 = { input_tokens: 8050, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 8000 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } };
    const u2 = { input_tokens: 9000, input_tokens_details: { cached_tokens: 8000, cache_write_tokens: 600 }, output_tokens: 120 };
    const { call } = fakeCall([resp([fnCall("c", "t")], "completed", u1), resp([message("답")], "completed", u2)]);
    const trace = newTrace();
    await runOpenAiAgentLoop(opts(call), trace);
    expect(trace.rounds.map((r) => [r.promptTokens, r.uncachedInputTokens, r.cacheWriteTokens, r.cacheReadTokens, r.outputTokens, r.thoughtTokens])).toEqual([
      [8050, 50, 8000, 0, 100, 200],
      [9000, 400, 600, 8000, 120, 0],
    ]);
  });

  it("Terra 비용: 비캐시 $1, 캐시 쓰기 $1.25, 캐시 읽기 $0.05, 출력(추론 포함) $5 per 1M", () => {
    const r = { promptTokens: 17_050, cacheWriteTokens: 8_600, cacheReadTokens: 8_000, outputTokens: 220, thoughtTokens: 200 } as RunResult;
    const p = pricesAt("2026-11-15T00:00:00.000Z", "gpt-6.1-terra@none");
    expect(sessionCost(r, p)).toBeCloseTo((450 * 1 + 8_600 * 1.25 + 8_000 * 0.05 + 420 * 5) / 1e6, 12);
    expect(p.label).not.toContain("미등록");
  });

  it("Gemini 3.8 Flash는 3.6과 같은 할인가·종료일이다(미등록이면 라벨에 미등록이 붙는다)", () => {
    const promo = pricesAt("2026-11-15T00:00:00.000Z", "gemini-3.8-flash@low");
    expect(promo.label).not.toContain("미등록");
    expect(promo.inPerToken).toBeCloseTo(0.75 / 1e6, 15);
    expect(pricesAt("2027-01-01T00:00:00.000Z", "gemini-3.8-flash@low").outPerToken).toBeCloseTo(7.5 / 1e6, 15);
  });

  it("Luna·Haiku 5.5 단가가 등록돼 있다(미등록이면 3.6-flash 값으로 조용히 계산된다)", () => {
    for (const m of ["gpt-6-luna@low", "claude-haiku-5-5@low"]) {
      const p = pricesAt("2026-11-15T00:00:00.000Z", m);
      expect(p.label).not.toContain("미등록");
      expect(p.inPerToken).toBeCloseTo(0.1 / 1e6, 15);
      expect(p.outPerToken).toBeCloseTo(0.5 / 1e6, 15);
      expect(p.cacheReadPerToken).toBeCloseTo(0.01 / 1e6, 15);
    }
  });
});

describe("toOpenAiTools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("모든 키가 있을 때의 실제 선언 전부를 이름·설명·스키마(enum·required 포함) 그대로 옮기고 strict를 끈다", async () => {
    for (const k of [
      "KAKAO_REST_API_KEY", "NAVER_LOCAL_CLIENT_ID", "NAVER_LOCAL_CLIENT_SECRET", "NCP_MAPS_CLIENT_ID", "NCP_MAPS_CLIENT_SECRET",
      "TOUR_API_KEY", "DATA_GO_KR_API_KEY", "SEOUL_OPEN_DATA_KEY", "SEOUL_SUBWAY_REALTIME_KEY", "ODSAY_API_KEY",
      "JUSO_CONFM_KEY", "TMAP_APP_KEY", "PERPLEXITY_API_KEY", "GOOGLE_PLACES_API_KEY",
    ]) vi.stubEnv(k, "x");
    const { availableDeclarations } = await import("@/lib/chat/declarations");
    const decls = availableDeclarations(new Set());
    const tools = toOpenAiTools(decls);
    expect(tools).toHaveLength(decls.length);
    expect(decls.length).toBeGreaterThanOrEqual(20);
    tools.forEach((t, i) => {
      expect(t.name).toBe(decls[i].name);
      expect(t.description).toBe(decls[i].description);
      expect(t.parameters).toEqual(decls[i].parametersJsonSchema ?? { type: "object", properties: {} });
      expect(t.strict).toBe(false);
      expect(t.type).toBe("function");
      expect(Object.keys(t).sort()).toEqual(["description", "name", "parameters", "strict", "type"]);
    });
    expect(JSON.stringify(tools)).toContain('"enum"');
    expect(JSON.stringify(tools)).toContain('"required"');
  });

  it("스키마는 깊은 복사다", () => {
    const decl = { name: "a", description: "d", parametersJsonSchema: { type: "object", properties: { x: { type: "string", enum: ["p"] } }, required: ["x"] } };
    const [t] = toOpenAiTools([decl]);
    (t.parameters.properties as Record<string, { enum: string[] }>).x.enum.push("q");
    expect(decl.parametersJsonSchema.properties.x.enum).toEqual(["p"]);
  });

  it("Gemini Type 스키마(parameters)는 조용히 버리지 않고 throw", () => {
    expect(() => toOpenAiTools([{ name: "a", parameters: { type: "OBJECT" } } as never])).toThrow("parameters");
  });
});
