import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_ATTEMPT_TIMEOUT_MS,
  CLAUDE_MAX_RETRIES,
  CLAUDE_ROUND_TIMEOUT_MS,
  CLAUDE_VERGILIUS_MODELS,
  createAnthropicClient,
  createClaudeSession,
  withoutRetryAfter,
  type ClaudeMessagesClient,
} from "../claude";
import { PROPOSE_GUIDE_TOOL, toAnthropicTools } from "../tools";
import type { ClaudeVergiliusProvider } from "../types";

type Event = Anthropic.MessageStreamEvent;

/** 한 회차의 가짜 응답: 스트림 이벤트와 마지막 메시지(또는 스트림 도중의 오류). */
interface FakeRound {
  events: Event[];
  final?: Partial<Anthropic.Message>;
  error?: unknown;
}

const textStart = (index: number): Event =>
  ({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } }) as Event;
const textDelta = (index: number, text: string): Event =>
  ({ type: "content_block_delta", index, delta: { type: "text_delta", text } }) as Event;
const thinkingDelta = (index: number, thinking: string): Event =>
  ({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking } }) as Event;
const toolStart = (index: number, id: string, name: string): Event =>
  ({ type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } }) as Event;

const usage = { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 1800, cache_creation_input_tokens: 0 };

function message(content: unknown[], stop_reason: string | null): Partial<Anthropic.Message> {
  return { content: content as Anthropic.ContentBlock[], stop_reason: stop_reason as Anthropic.StopReason, usage: usage as Anthropic.Usage };
}

function claudeHarness(rounds: FakeRound[], opts: { provider?: ClaudeVergiliusProvider; signal?: AbortSignal } = {}) {
  const bodies: Anthropic.MessageStreamParams[] = [];
  const options: (Anthropic.RequestOptions | undefined)[] = [];
  const logs: string[] = [];
  const client: ClaudeMessagesClient = {
    messages: {
      stream(body, requestOptions) {
        // 이력은 세션이 계속 고치는 배열이라 호출 시점의 모양을 떠 둔다.
        bodies.push(structuredClone(body));
        options.push(requestOptions);
        const round = rounds.shift();
        if (!round) throw new Error("no more rounds");
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of round.events) yield e;
            if (round.error) throw round.error;
          },
          finalMessage: async () => {
            if (round.error) throw round.error;
            return { id: "msg", type: "message", role: "assistant", model: "m", ...round.final } as Anthropic.Message;
          },
        };
      },
    },
  };
  const session = createClaudeSession({
    client,
    provider: opts.provider ?? "claude-opus",
    instruction: "지침",
    material: "재료와 질문",
    tools: toAnthropicTools([PROPOSE_GUIDE_TOOL]),
    signal: opts.signal,
    log: (line) => logs.push(line),
  });
  return { session, bodies, options, logs };
}

const noop = { onText: () => {}, onCall: () => {} };

describe("Claude 어댑터(Messages API 스트림)", () => {
  it("요청(Opus): 생각 설정 없이 effort low, 지침에 캐시 표시, 도구 선택 auto, 재료는 첫 user 글", async () => {
    const h = claudeHarness([{ events: [textStart(0), textDelta(0, "답.")], final: message([{ type: "text", text: "답." }], "end_turn") }]);
    const onText = vi.fn();
    const r = await h.session.round({ tools: true, onText, onCall: vi.fn() });
    expect(r).toEqual({ text: "답.", calls: [] });
    expect(onText).toHaveBeenCalledWith("답.");
    expect(h.bodies[0]).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      system: [{ type: "text", text: "지침", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "재료와 질문" }],
      tools: toAnthropicTools([PROPOSE_GUIDE_TOOL]),
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
    });
    // Opus 5.5는 생각을 끌 수 없다: thinking 필드 자체가 없어야 한다(disabled는 400).
    expect("thinking" in h.bodies[0]).toBe(false);
    // 거절 시 다른 모델로 몰래 다시 돌리지 않는다(서버 측 fallbacks 없음).
    expect("fallbacks" in h.bodies[0]).toBe(false);
  });

  it("요청(Sonnet): thinking은 between_tools 하나만, effort low", async () => {
    const h = claudeHarness(
      [{ events: [textDelta(0, "답.")], final: message([{ type: "text", text: "답." }], "end_turn") }],
      { provider: "claude-sonnet" },
    );
    await h.session.round({ tools: true, ...noop });
    expect(h.bodies[0].model).toBe("claude-sonnet-5-5");
    expect(h.bodies[0].thinking).toEqual({ type: "between_tools" });
    expect(h.bodies[0].output_config).toEqual({ effort: "low" });
    expect(CLAUDE_VERGILIUS_MODELS).toEqual({ "claude-opus": "claude-opus-5-5", "claude-sonnet": "claude-sonnet-5-5" });
  });

  it("글 조각은 그대로 흘리고 생각 조각은 글로 내보내지 않는다", async () => {
    const h = claudeHarness([
      {
        events: [thinkingDelta(0, "속생각"), textStart(1), textDelta(1, "왼쪽 12미터에 "), textDelta(1, "가나카페.")],
        final: message([{ type: "thinking", thinking: "", signature: "S" }, { type: "text", text: "왼쪽 12미터에 가나카페." }], "end_turn"),
      },
    ]);
    const onText = vi.fn();
    const r = await h.session.round({ tools: true, onText, onCall: vi.fn() });
    expect(onText.mock.calls.map((c) => c[0])).toEqual(["왼쪽 12미터에 ", "가나카페."]);
    expect(r.text).toBe("왼쪽 12미터에 가나카페.");
  });

  it("도구 왕복: 짝은 tool_use_id이고, 도구를 부른 회차의 내용은 생각 블록·서명째 그대로 이력에 들어간다", async () => {
    const firstContent = [
      { type: "thinking", thinking: "", signature: "SIG-1" },
      { type: "tool_use", id: "toolu_A", name: "get_walk_route", input: { destination: "시청" } },
      { type: "tool_use", id: "toolu_B", name: "get_walk_route", input: { destination: "광화문" } },
    ];
    const h = claudeHarness([
      {
        events: [toolStart(1, "toolu_A", "get_walk_route"), toolStart(2, "toolu_B", "get_walk_route")],
        final: message(firstContent, "tool_use"),
      },
      { events: [textDelta(0, "시청이 더 가깝습니다.")], final: message([{ type: "text", text: "시청이 더 가깝습니다." }], "end_turn") },
    ]);
    const onCall = vi.fn();
    const first = await h.session.round({ tools: true, onText: vi.fn(), onCall });
    expect(onCall).toHaveBeenCalledTimes(2);
    expect(first.calls).toEqual([
      { id: "toolu_A", name: "get_walk_route", args: { destination: "시청" } },
      { id: "toolu_B", name: "get_walk_route", args: { destination: "광화문" } },
    ]);
    // 결과를 호출과 반대 순서로 넣어도 id로 짝이 맞는다.
    h.session.pushToolResults([
      { call: first.calls[1], response: { minutes: 13 } },
      { call: first.calls[0], response: { minutes: 7 } },
    ]);
    const second = await h.session.round({ tools: false, ...noop });
    expect(second.text).toBe("시청이 더 가깝습니다.");
    expect(h.bodies[1].messages).toEqual([
      { role: "user", content: "재료와 질문" },
      { role: "assistant", content: firstContent },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_B", content: '{"minutes":13}' },
          { type: "tool_result", tool_use_id: "toolu_A", content: '{"minutes":7}' },
        ],
      },
    ]);
    // 닫힌 회차는 선택만 막고 선언·지침은 바이트 그대로다(캐시와 생각 블록의 앞부분 대조).
    expect(h.bodies[1].tool_choice).toEqual({ type: "none" });
    expect(h.bodies[1].tools).toEqual(h.bodies[0].tools);
    expect(h.bodies[1].system).toEqual(h.bodies[0].system);
  });

  it("인자가 객체가 아니면 빈 인자가 된다(실행부가 오류로 답한다)", async () => {
    const h = claudeHarness([
      {
        events: [toolStart(0, "toolu_A", "get_walk_route")],
        final: message([{ type: "tool_use", id: "toolu_A", name: "get_walk_route", input: "깨짐" }], "tool_use"),
      },
    ]);
    const r = await h.session.round({ tools: true, ...noop });
    expect(r.calls[0].args).toEqual({});
  });

  it("3-state: refusal·max_tokens·그 밖의 stop_reason은 던진다(잘린 글이나 거절을 답으로 접지 않는다)", async () => {
    const round = (stop: string | null) =>
      claudeHarness([{ events: [textDelta(0, "왼쪽 12미터에 가나")], final: message([{ type: "text", text: "왼쪽 12미터에 가나" }], stop) }])
        .session.round({ tools: true, ...noop });
    await expect(round("refusal")).rejects.toThrow("claude stop refusal");
    await expect(round("max_tokens")).rejects.toThrow("claude stop max_tokens");
    await expect(round("pause_turn")).rejects.toThrow("claude stop pause_turn");
    await expect(round("model_context_window_exceeded")).rejects.toThrow("claude stop context");
    await expect(round("새로운_값")).rejects.toThrow("claude stop unexpected");
    await expect(round(null)).rejects.toThrow("claude stop null");
    await expect(round("end_turn")).resolves.toEqual({ text: "왼쪽 12미터에 가나", calls: [] });
  });

  it("거절된 회차의 도구 호출은 실행부로 가지 않는다(던지므로 호출 목록이 나오지 않는다)", async () => {
    const h = claudeHarness([
      {
        events: [toolStart(0, "toolu_A", "get_walk_route")],
        final: message([{ type: "tool_use", id: "toolu_A", name: "get_walk_route", input: {} }], "refusal"),
      },
    ]);
    await expect(h.session.round({ tools: true, ...noop })).rejects.toThrow("claude stop refusal");
  });

  it("SDK 오류는 고정 낱말의 종류와 상태 코드로 바뀐다(회사 메시지 본문을 싣지 않는다)", async () => {
    const round = (error: unknown) => claudeHarness([{ events: [], error }]).session.round({ tools: true, ...noop });
    await expect(round(new Anthropic.APIUserAbortError())).rejects.toMatchObject({ kind: "claude aborted", status: null });
    await expect(round(new Anthropic.APIConnectionTimeoutError())).rejects.toMatchObject({ kind: "claude timeout" });
    await expect(round(new Anthropic.APIConnectionError({ message: "x" }))).rejects.toMatchObject({ kind: "claude connection" });
    const overloaded = new Anthropic.InternalServerError(529, undefined, "지금 내 앞에 가나카페", new Headers());
    const err = (await round(overloaded).catch((e: unknown) => e)) as Error & { kind: string; status: number };
    expect(err).toMatchObject({ kind: "claude messages", status: 529 });
    expect(err.message).not.toContain("가나카페");
    await expect(round(new Anthropic.AnthropicError("stream ended"))).rejects.toMatchObject({ kind: "claude stream" });
  });

  it("요청 신호가 SDK 요청에 닿는다: 바깥에서 거두면 모델 호출의 신호도 닫힌다(신호가 없어도 회차 시한은 걸린다)", async () => {
    const controller = new AbortController();
    const done = (): FakeRound => ({ events: [textDelta(0, "답.")], final: message([{ type: "text", text: "답." }], "end_turn") });
    const h = claudeHarness([done()], { signal: controller.signal });
    await h.session.round({ tools: true, ...noop });
    const sent = h.options[0]?.signal as AbortSignal;
    expect(sent.aborted).toBe(false);
    controller.abort();
    expect(sent.aborted).toBe(true);
    const bare = claudeHarness([done()]);
    await bare.session.round({ tools: true, ...noop });
    expect(bare.options[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("로그는 모델·회차·stop_reason·지연·토큰뿐이다(질문 글·재료·답 글 없음)", async () => {
    const h = claudeHarness([
      { events: [textDelta(0, "왼쪽에 가나카페.")], final: message([{ type: "text", text: "왼쪽에 가나카페." }], "end_turn") },
    ]);
    await h.session.round({ tools: true, ...noop });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(
      /^\[vergilius\] claude-opus-5-5 round=1 stop=end_turn first_text_ms=\d+ total_ms=\d+ in=900 cache_read=1800 cache_write=0 out=40$/,
    );
    for (const secret of ["재료", "질문", "가나카페", "지침"]) expect(h.logs[0]).not.toContain(secret);
  });

  it("요청 쪽에서 거둔 중단은 회차 시한과 다른 종류로 남는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = claudeHarness([{ events: [], error: new Anthropic.APIUserAbortError() }], { signal: controller.signal });
    await expect(h.session.round({ tools: true, ...noop })).rejects.toMatchObject({ kind: "claude request aborted" });
  });

  it("클라이언트: 재시도 1회, 시도당 응답 머리 시한 8초, SDK 로거 끔 — 두 번 시도와 대기가 회차 시한 20초 안에 든다", () => {
    const client = createAnthropicClient("sk-ant-test") as unknown as Anthropic;
    expect(client.maxRetries).toBe(CLAUDE_MAX_RETRIES);
    expect(client.timeout).toBe(CLAUDE_ATTEMPT_TIMEOUT_MS);
    expect(client.logLevel).toBe("off");
    // 대기는 SDK 기본 지수 대기의 첫 값(0.5초)이다. 회사의 재시도 대기 머리는 아래 테스트처럼 지운다.
    expect(CLAUDE_ATTEMPT_TIMEOUT_MS * (CLAUDE_MAX_RETRIES + 1) + 500).toBeLessThan(CLAUDE_ROUND_TIMEOUT_MS);
  });

  it("재시도 대기 머리: 실패 응답에서만 지우고 상태·본문은 그대로, 성공 응답은 손대지 않는다", async () => {
    const failed = new Response('{"type":"error"}', { status: 429, headers: { "retry-after": "30", "retry-after-ms": "30000", "request-id": "r1" } });
    const out = await withoutRetryAfter(async () => failed)("https://api.anthropic.com/v1/messages");
    expect(out.status).toBe(429);
    expect(out.headers.has("retry-after")).toBe(false);
    expect(out.headers.has("retry-after-ms")).toBe(false);
    expect(out.headers.get("request-id")).toBe("r1");
    expect(await out.text()).toBe('{"type":"error"}');
    const ok = new Response("{}", { status: 200, headers: { "retry-after": "5" } });
    expect(await withoutRetryAfter(async () => ok)("https://x")).toBe(ok);
  });

  it("429가 30초를 기다리라 해도 한 번 다시 해 보고 몇 초 안에 상태 코드를 단 실패로 끝난다(회차 시한까지 멈추지 않는다)", async () => {
    const calls: number[] = [];
    const started = Date.now();
    const fakeFetch = async () => {
      calls.push(Date.now() - started);
      return new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "지금 내 앞에 가나카페" } }), {
        status: 429,
        headers: { "retry-after": "30", "content-type": "application/json" },
      });
    };
    const session = createClaudeSession({
      client: createAnthropicClient("sk-ant-test", fakeFetch),
      provider: "claude-sonnet",
      instruction: "지침",
      material: "재료",
      tools: [],
      log: () => {},
    });
    const err = (await session.round({ tools: true, ...noop }).catch((e: unknown) => e)) as Error & { kind: string; status: number };
    expect(err).toMatchObject({ kind: "claude messages", status: 429 });
    expect(err.message).not.toContain("가나카페");
    expect(calls).toHaveLength(CLAUDE_MAX_RETRIES + 1);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
