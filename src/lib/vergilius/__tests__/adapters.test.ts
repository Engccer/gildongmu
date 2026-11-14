import { describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { createGoogleSession, GOOGLE_VERGILIUS_MODEL } from "../google";
import { createOpenAiSession, OPENAI_VERGILIUS_MODEL, readSseJson } from "../openai";
import { PROPOSE_GUIDE_TOOL, toGeminiDeclarations, toOpenAiTools } from "../tools";

function sseResponse(events: Record<string, unknown>[], chunkSize = 37): Response {
  const raw = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 이벤트 경계와 무관한 크기로 잘라 보낸다(여러 바이트 글자가 조각 사이에 걸린다).
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const fnAdded = (callId: string, name: string) => ({
  type: "response.output_item.added",
  item: { type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: "" },
});
const fnDone = (callId: string, name: string, args: Record<string, unknown>) => ({
  type: "response.output_item.done",
  item: { type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: "completed" },
});
const textDelta = (delta: string) => ({ type: "response.output_text.delta", delta });
const completed = { type: "response.completed", response: { output: [] } };

function openAiHarness(responses: Response[], signal?: AbortSignal) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  }) as unknown as typeof fetch;
  const session = createOpenAiSession({
    apiKey: "sk-test",
    instruction: "지침",
    material: "재료와 질문",
    tools: toOpenAiTools([PROPOSE_GUIDE_TOOL]),
    fetchImpl,
    signal,
  });
  return { session, bodies, fetchImpl };
}

describe("OpenAI 어댑터(Responses API)", () => {
  it("SSE 판독: 조각 경계가 글자 중간에 걸려도 이벤트를 온전히 읽는다", async () => {
    const res = sseResponse([textDelta("왼쪽에 가나카페"), completed], 5);
    const types: unknown[] = [];
    for await (const e of readSseJson(res.body!)) types.push(e.delta ?? e.type);
    expect(types).toEqual(["왼쪽에 가나카페", "response.completed"]);
  });

  it("요청: 모델 상수, 추론 끔, 저장 안 함, 스트림, 지침과 재료의 자리", async () => {
    const h = openAiHarness([sseResponse([textDelta("답."), completed])]);
    const onText = vi.fn();
    const result = await h.session.round({ tools: true, onText, onCall: vi.fn() });
    expect(result).toEqual({ text: "답.", calls: [] });
    expect(onText).toHaveBeenCalledWith("답.");
    expect(h.bodies[0]).toMatchObject({
      model: OPENAI_VERGILIUS_MODEL,
      instructions: "지침",
      input: [{ role: "user", content: "재료와 질문" }],
      tool_choice: "auto",
      reasoning: { effort: "none" },
      stream: true,
      store: false,
    });
    const init = vi.mocked(h.fetchImpl).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("병렬 도구 호출의 짝은 호출 id다: 같은 도구를 두 번 불러도 결과가 제 호출에 붙는다", async () => {
    const h = openAiHarness([
      sseResponse([
        fnAdded("call_A", "get_walk_route"),
        fnDone("call_A", "get_walk_route", { destination: "시청" }),
        fnAdded("call_B", "get_walk_route"),
        fnDone("call_B", "get_walk_route", { destination: "광화문" }),
        completed,
      ]),
      sseResponse([textDelta("시청이 더 가깝습니다."), completed]),
    ]);
    const onCall = vi.fn();
    const first = await h.session.round({ tools: true, onText: vi.fn(), onCall });
    expect(onCall).toHaveBeenCalledTimes(2);
    expect(first.calls).toEqual([
      { id: "call_A", name: "get_walk_route", args: { destination: "시청" } },
      { id: "call_B", name: "get_walk_route", args: { destination: "광화문" } },
    ]);
    // 결과를 호출과 반대 순서로 넣어도 id로 짝이 맞는다.
    h.session.pushToolResults([
      { call: first.calls[1], response: { minutes: 13 } },
      { call: first.calls[0], response: { minutes: 7 } },
    ]);
    await h.session.round({ tools: false, onText: vi.fn(), onCall: vi.fn() });
    const input = h.bodies[1].input as Record<string, unknown>[];
    expect(input.slice(1)).toEqual([
      { type: "function_call", call_id: "call_A", name: "get_walk_route", arguments: '{"destination":"시청"}' },
      { type: "function_call", call_id: "call_B", name: "get_walk_route", arguments: '{"destination":"광화문"}' },
      { type: "function_call_output", call_id: "call_B", output: '{"minutes":13}' },
      { type: "function_call_output", call_id: "call_A", output: '{"minutes":7}' },
    ]);
    // 도구를 닫은 회차도 선언은 남기고 선택만 막는다.
    expect(h.bodies[1].tool_choice).toBe("none");
    expect(h.bodies[1].tools).toEqual(h.bodies[0].tools);
  });

  it("요청 신호가 fetch에 닿는다: 바깥에서 거두면 모델 호출의 신호도 닫힌다(신호가 없어도 회차 시한은 걸린다)", async () => {
    const controller = new AbortController();
    const h = openAiHarness([sseResponse([textDelta("답."), completed])], controller.signal);
    await h.session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    const sent = (vi.mocked(h.fetchImpl).mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(sent.aborted).toBe(false);
    controller.abort();
    expect(sent.aborted).toBe(true);
    const bare = openAiHarness([sseResponse([textDelta("답."), completed])]);
    await bare.session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    expect((vi.mocked(bare.fetchImpl).mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("깨진 인자 JSON은 빈 인자가 된다(실행부가 오류로 답한다)", async () => {
    const h = openAiHarness([
      sseResponse([
        fnAdded("call_A", "get_walk_route"),
        { type: "response.output_item.done", item: { type: "function_call", call_id: "call_A", name: "get_walk_route", arguments: "{\"dest" } },
        completed,
      ]),
    ]);
    const r = await h.session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    expect(r.calls[0].args).toEqual({});
  });

  it("3-state: HTTP 오류, 실패 이벤트, 끝맺음 없는 스트림은 던진다(빈 답으로 접지 않는다)", async () => {
    const round = (res: Response) =>
      openAiHarness([res]).session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    await expect(round(new Response("{}", { status: 429 }))).rejects.toThrow("openai responses 429");
    await expect(round(sseResponse([{ type: "response.failed" }]))).rejects.toThrow("response.failed");
    await expect(round(sseResponse([textDelta("왼쪽에")]))).rejects.toThrow("ended early");
  });
});

function googleHarness(rounds: unknown[][], opts: { signal?: AbortSignal; finish?: (string | undefined)[] } = {}) {
  const requests: Record<string, unknown>[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const finish = opts.finish ?? [];
  const generateContentStream = vi.fn(async (params: Record<string, unknown>) => {
    // 이력은 세션이 계속 고치는 배열이라 호출 시점의 모양을 떠 둔다.
    requests.push(JSON.parse(JSON.stringify(params, (k, v) => (k === "abortSignal" ? undefined : v))) as Record<string, unknown>);
    signals.push((params.config as { abortSignal?: AbortSignal }).abortSignal);
    const chunks = rounds.shift() ?? [];
    // 실제 API처럼 마지막 조각에만 finishReason을 싣는다(기본 STOP).
    const reason = requests.length <= finish.length ? finish[requests.length - 1] : "STOP";
    return (async function* () {
      for (const [i, parts] of chunks.entries()) {
        const last = i === chunks.length - 1;
        yield { candidates: [{ content: { role: "model", parts }, ...(last && reason ? { finishReason: reason } : {}) }] };
      }
    })();
  });
  const ai = { models: { generateContentStream } } as unknown as Pick<GoogleGenAI, "models">;
  const session = createGoogleSession({
    ai,
    instruction: "지침",
    material: "재료와 질문",
    declarations: toGeminiDeclarations([PROPOSE_GUIDE_TOOL]),
    signal: opts.signal,
  });
  return { session, requests, signals };
}

describe("Google 어댑터(Gemini)", () => {
  it("요청: 모델 상수, 생각 최소, 지침과 재료의 자리", async () => {
    const h = googleHarness([[[{ text: "왼쪽에 " }], [{ text: "가나카페." }]]]);
    const onText = vi.fn();
    const r = await h.session.round({ tools: true, onText, onCall: vi.fn() });
    expect(r).toEqual({ text: "왼쪽에 가나카페.", calls: [] });
    expect(onText.mock.calls.map((c) => c[0])).toEqual(["왼쪽에 ", "가나카페."]);
    expect(h.requests[0]).toMatchObject({
      model: GOOGLE_VERGILIUS_MODEL,
      contents: [{ role: "user", parts: [{ text: "재료와 질문" }] }],
      config: {
        systemInstruction: "지침",
        thinkingConfig: { thinkingLevel: "MINIMAL" },
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      },
    });
  });

  it("3-state: 마지막 finishReason이 STOP이 아니거나 없으면 던진다(잘린 글을 답으로 접지 않는다)", async () => {
    const round = (finish: string | undefined) =>
      googleHarness([[[{ text: "왼쪽 12미터에 가나" }]]], { finish: [finish] }).session.round({
        tools: true, onText: vi.fn(), onCall: vi.fn(),
      });
    await expect(round("MAX_TOKENS")).rejects.toThrow("google finish MAX_TOKENS");
    await expect(round("SAFETY")).rejects.toThrow("google finish SAFETY");
    await expect(round(undefined)).rejects.toThrow("ended early");
    await expect(round("STOP")).resolves.toEqual({ text: "왼쪽 12미터에 가나", calls: [] });
  });

  it("요청 신호가 모델 호출에 닿는다", async () => {
    const controller = new AbortController();
    const h = googleHarness([[[{ text: "답." }]]], { signal: controller.signal });
    await h.session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    expect(h.signals[0]?.aborted).toBe(false);
    controller.abort();
    expect(h.signals[0]?.aborted).toBe(true);
  });

  it("생각 서명 보존: 모델 회차의 parts를 서명째 그대로 다음 요청에 싣는다", async () => {
    const callPartA = { functionCall: { name: "get_walk_route", args: { destination: "시청" } }, thoughtSignature: "SIG-A" };
    const callPartB = { functionCall: { name: "get_bus_arrivals", args: {} } };
    const h = googleHarness([
      [[{ text: "생각 중", thought: true }], [callPartA], [callPartB]],
      [[{ text: "7분 걸립니다." }]],
    ]);
    const onText = vi.fn();
    const first = await h.session.round({ tools: true, onText, onCall: vi.fn() });
    // 생각 part는 글로 내보내지 않는다.
    expect(onText).not.toHaveBeenCalled();
    expect(first.text).toBe("");
    h.session.pushToolResults(first.calls.map((call) => ({ call, response: { ok: call.name } })));
    await h.session.round({ tools: false, onText: vi.fn(), onCall: vi.fn() });
    const contents = h.requests[1].contents as { role: string; parts: unknown[] }[];
    expect(contents[1]).toEqual({ role: "model", parts: [{ text: "생각 중", thought: true }, callPartA, callPartB] });
    expect(h.requests[1]).toMatchObject({ config: { toolConfig: { functionCallingConfig: { mode: "NONE" } } } });
  });

  it("병렬 도구 호출의 짝은 이름과 순서다: 결과는 호출 순서 그대로 한 user content에 담긴다", async () => {
    const h = googleHarness([
      [[
        { functionCall: { name: "get_walk_route", args: { destination: "시청" } } },
        { functionCall: { id: "fc-2", name: "get_car_route", args: { destination: "시청" } } },
      ]],
      [[{ text: "끝." }]],
    ]);
    const first = await h.session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    expect(first.calls.map((c) => [c.id, c.name])).toEqual([[null, "get_walk_route"], ["fc-2", "get_car_route"]]);
    h.session.pushToolResults(first.calls.map((call) => ({ call, response: { from: call.name } })));
    await h.session.round({ tools: true, onText: vi.fn(), onCall: vi.fn() });
    const contents = h.requests[1].contents as { role: string; parts: unknown[] }[];
    expect(contents[2]).toEqual({
      role: "user",
      parts: [
        { functionResponse: { name: "get_walk_route", response: { from: "get_walk_route" } } },
        { functionResponse: { id: "fc-2", name: "get_car_route", response: { from: "get_car_route" } } },
      ],
    });
  });
});
