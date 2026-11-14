/**
 * Claude 채팅 모델 A/B 러너(E86 보충). **하네스 전용**이다 — 운영 채팅 경로(`/api/chat`·`runAgentLoop`)는 바꾸지 않는다.
 *
 * 모델 외 변수가 섞이지 않게 Gemini 러너와 같은 재료를 쓴다:
 * - systemInstruction: `buildChatSystemInstruction` 정본 문자열 그대로(`model-ab.spec.ts`가 넘긴다)
 * - 도구 선언: `availableDeclarations`의 `parametersJsonSchema`를 **그대로** `input_schema`로 옮긴다(설명·enum·required 보존).
 *   `strict`·`eager_input_streaming`은 얹지 않는다(Gemini 쪽에 없는 제약이라 변수가 된다).
 * - 도구 실행: `executeFunction`(router) 그대로, `Promise.allSettled` 병렬, 실패는 `{ error: String(reason) }`.
 * - 루프 상한: `maxIterations` 6, 루프 뒤 답이 비면 도구 없이 1회 더(I-2). Claude는 기록에 `tool_use`가 있으면 도구 선언을
 *   빼고 보낼 수 없어 `tool_choice: none`으로 같은 효과를 낸다(선언 목록·순서가 그대로라 캐시·생각 블록도 유지된다).
 *
 * Claude 쪽에만 있는 것:
 * - 프롬프트 캐싱: system 끝에 명시 지점 1개(도구+system 고정 접두) + 요청 최상위 자동 지점(자라는 대화 꼬리).
 *   출력에는 영향이 없고 비용만 바뀐다. 적중은 `cache_read_input_tokens`로 기록한다.
 * - `stop_reason`이 `refusal`·`max_tokens`·`model_context_window_exceeded`면 그 세션은 실패다(서버 `fallbacks`는 쓰지 않는다 —
 *   다른 모델이 대신 답하면 측정이 오염된다).
 *   Gemini 러너는 `finishReason`으로 실패를 가르지 않으므로(기록만 한다) 이 축은 두 회사가 비대칭이다 — 리포트에서 따로 읽는다.
 * - 실패한 도구 결과에 `is_error: true`를 붙인다(Anthropic 규약. Gemini `functionResponse`엔 대응 필드가 없어 작은 비대칭).
 * - 재시도: SDK 재시도를 끈다(`maxRetries: 0`, `model-ab.spec.ts`). Gemini 러너도 재시도하지 않으므로 일시 오류는 두 회사 모두
 *   그 세션의 실패로 남는다(대기 시간이 지연에 숨지 않는다). 리포트에서 API 오류와 품질 실패를 갈라 읽는다.
 * - 전송은 스트리밍(`messages.stream` → `finalMessage`)이다. 모델 출력은 비스트리밍과 같고, 마지막 답 회차의 첫 글자 시각을
 *   잴 수 있다. 운영 채팅은 답을 완료 시점에 한 번 보내므로 운영 경로의 체감은 총지연이다(첫 글자는 "스트리밍했다면"의 값).
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { FunctionDeclaration } from "@google/genai";
import { executeFunction } from "@/lib/chat/router";
import { dedupeSources } from "@/lib/chat/sources";
import type { ExecutionContext, SourceAttribution } from "@/lib/chat/types";
import type { ToolOutput } from "./grounding";

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeSpec {
  model: string;
  /** 없으면 보내지 않는다(그 모델의 API 기본값). */
  effort: ClaudeEffort | null;
  /** Sonnet 5.5 전용 생각 끄기. 없으면 `thinking`을 보내지 않는다(적응형). */
  betweenTools: boolean;
}

const EFFORTS: readonly ClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

export function isClaudeModel(spec: string): boolean {
  return spec.startsWith("claude-");
}

/**
 * 실행기 모델 표기 `claude-<모델>[@<effort>][+between_tools]`를 가른다.
 * 예: `claude-opus-5-5@low`, `claude-sonnet-5-5@low+between_tools`. 모르는 접미사는 조용히 버리지 않고 throw한다
 * (오타 하나로 다른 설정의 측정이 같은 이름으로 기록되는 것을 막는다).
 */
export function parseClaudeSpec(spec: string): ClaudeSpec {
  const [head, ...flags] = spec.split("+");
  for (const f of flags) if (f !== "between_tools") throw new Error(`모르는 Claude 표기 접미사: +${f}`);
  const at = head.indexOf("@");
  const model = at < 0 ? head : head.slice(0, at);
  const effortRaw = at < 0 ? null : head.slice(at + 1);
  if (effortRaw !== null && !EFFORTS.includes(effortRaw as ClaudeEffort)) throw new Error(`모르는 effort: ${effortRaw}`);
  const betweenTools = flags.includes("between_tools");
  if (betweenTools && (effortRaw === "xhigh" || effortRaw === "max")) throw new Error("between_tools는 effort high 이하에서만 받는다");
  return { model, effort: effortRaw as ClaudeEffort | null, betweenTools };
}

/**
 * Gemini 함수 선언 → Anthropic 사용자 정의 도구. 스키마는 깊은 복사만 하고 손대지 않는다.
 * `parametersJsonSchema` 대신 Gemini 고유 `parameters`(Type enum 스키마)를 쓰는 선언이 생기면 옮기지 않고 throw한다 —
 * 조용히 빈 스키마로 바꾸면 인자 설명·enum이 사라진 채 측정된다.
 */
export function toAnthropicTools(decls: FunctionDeclaration[]): Anthropic.Tool[] {
  return decls.map((d) => {
    if (!d.name) throw new Error("이름 없는 선언");
    if (d.parameters) throw new Error(`${d.name}: parameters(Gemini Type 스키마)는 변환하지 않는다 — parametersJsonSchema로 선언할 것`);
    const schema = d.parametersJsonSchema
      ? (structuredClone(d.parametersJsonSchema) as Anthropic.Tool.InputSchema)
      : ({ type: "object", properties: {} } as Anthropic.Tool.InputSchema);
    if (schema.type !== "object") throw new Error(`${d.name}: 최상위 스키마가 object가 아니다`);
    return { name: d.name, ...(d.description ? { description: d.description } : {}), input_schema: schema };
  });
}

/** 테스트에서 가짜 SDK를 넣을 수 있게 러너가 쓰는 표면만 좁힌다. */
export interface ClaudeStreamLike {
  on(event: "text", listener: (delta: string) => void): unknown;
  on(event: "streamEvent", listener: () => void): unknown;
  finalMessage(): Promise<Anthropic.Message>;
}
export interface ClaudeClientLike {
  messages: { stream(params: Anthropic.MessageStreamParams): ClaudeStreamLike };
}

export interface ClaudeRoundStat {
  ms: number;
  /** 회차 시작 → 첫 text 델타(ms). 그 회차에 글이 없으면 null. */
  firstTextMs: number | null;
  /** 회차 시작 → 첫 응답 이벤트(message_start, 서버가 응답을 시작한 시각). */
  firstEventMs: number | null;
  /** text 델타 개수(한 덩어리로 왔는지 나눠 왔는지). */
  textDeltas: number;
  /** 세션 시작 기준 이 회차의 시작 시각(ms). */
  startedAt: number;
  stopReason: string | null;
  /** 캐시 포함 입력 총량(= input + cache_creation + cache_read). Gemini `promptTokenCount`와 같은 뜻. */
  promptTokens: number;
  uncachedInputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** 생각을 뺀 출력. 생각 토큰 수를 API가 주지 않으면 output_tokens 전부. */
  outputTokens: number;
  thoughtTokens: number;
  toolCalls: string[];
  toolArgs: { name: string; args: Record<string, unknown> }[];
}

export class ClaudeStopError extends Error {
  constructor(
    readonly stopReason: string,
    readonly detail: string,
  ) {
    super(`stop_reason=${stopReason}${detail ? ` (${detail})` : ""}`);
  }
}

/** 실패로 기록하는 정지 사유. `end_turn`·`tool_use`·`stop_sequence` 밖이면 답을 믿을 수 없다. */
const FAILING_STOPS = new Set(["refusal", "max_tokens", "model_context_window_exceeded", "pause_turn"]);

export interface ClaudeLoopOptions {
  client: ClaudeClientLike;
  spec: ClaudeSpec;
  systemInstruction: string;
  tools: Anthropic.Tool[];
  /** 사용자 발화들(케이스의 `turns`). 연속 user 메시지는 API가 한 턴으로 합친다(Gemini history와 같은 모양). */
  turns: string[];
  ctx: ExecutionContext;
  maxIterations?: number;
  maxTokens?: number;
}

export interface ClaudeLoopResult {
  text: string;
  renders: { type: string }[];
  sources: number;
  /** 세션 시작 → 반환한 답 글의 첫 text 델타(ms). 글이 없으면 undefined. */
  ttftMs?: number;
}

export interface ClaudeLoopTrace {
  rounds: ClaudeRoundStat[];
  toolOutputs: ToolOutput[];
}

function usageOf(m: Anthropic.Message) {
  const u = m.usage;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const thought = u.output_tokens_details?.thinking_tokens ?? 0;
  return {
    promptTokens: u.input_tokens + cacheWrite + cacheRead,
    uncachedInputTokens: u.input_tokens,
    cacheWriteTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    outputTokens: u.output_tokens - thought,
    thoughtTokens: thought,
  };
}

function textOf(m: Anthropic.Message): string {
  return m.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * `runAgentLoop`(src/lib/chat/agent-loop.ts)의 Claude판 거울. 루프 모양을 바꾸면 그쪽과 함께 본다.
 * 계측은 `trace`에 쌓고, 실패(정지 사유·API 오류)는 throw한다 — 호출부가 지금까지의 trace로 실패 결과를 적는다.
 */
export async function runClaudeAgentLoop(opts: ClaudeLoopOptions, trace: ClaudeLoopTrace): Promise<ClaudeLoopResult> {
  const { client, spec, systemInstruction, tools, ctx } = opts;
  const maxIterations = opts.maxIterations ?? 6;
  const t0 = Date.now();
  const messages: Anthropic.MessageParam[] = opts.turns.map((t) => ({ role: "user", content: t }));
  const renders: { type: string }[] = [];
  const sources: SourceAttribution[] = [];

  const call = async (toolChoice: Anthropic.ToolChoice) => {
    const params: Anthropic.MessageStreamParams = {
      model: spec.model,
      max_tokens: opts.maxTokens ?? 32_000,
      system: [{ type: "text", text: systemInstruction, cache_control: { type: "ephemeral" } }],
      tools,
      tool_choice: toolChoice,
      messages: [...messages],
      cache_control: { type: "ephemeral" },
      ...(spec.effort ? { output_config: { effort: spec.effort } } : {}),
      ...(spec.betweenTools ? { thinking: { type: "between_tools" } } : {}),
    };
    const startedAt = Date.now();
    let firstTextAt: number | null = null;
    let firstEventAt: number | null = null;
    let textDeltas = 0;
    const stream = client.messages.stream(params);
    stream.on("streamEvent", () => {
      if (firstEventAt === null) firstEventAt = Date.now();
    });
    stream.on("text", (delta) => {
      if (delta.length === 0) return;
      textDeltas++;
      if (firstTextAt === null) firstTextAt = Date.now();
    });
    const msg = await stream.finalMessage();
    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    trace.rounds.push({
      ms: Date.now() - startedAt,
      firstTextMs: firstTextAt === null ? null : firstTextAt - startedAt,
      firstEventMs: firstEventAt === null ? null : firstEventAt - startedAt,
      textDeltas,
      startedAt: startedAt - t0,
      stopReason: msg.stop_reason,
      ...usageOf(msg),
      toolCalls: toolUses.map((b) => b.name),
      toolArgs: toolUses.map((b) => ({ name: b.name, args: (b.input ?? {}) as Record<string, unknown> })),
    });
    if (msg.stop_reason && FAILING_STOPS.has(msg.stop_reason)) {
      const cat = msg.stop_details?.category ?? "";
      throw new ClaudeStopError(msg.stop_reason, cat ? `category=${cat}` : "");
    }
    return { msg, toolUses, firstTextAt };
  };

  let res = await call({ type: "auto" });
  for (let iter = 0; iter < maxIterations; iter++) {
    if (res.toolUses.length === 0) break;
    // 생각 블록을 포함한 assistant 내용을 바꾸지 않고 붙인다(append-only — 캐시·생각 블록 유효성).
    messages.push({ role: "assistant", content: res.msg.content as Anthropic.ContentBlockParam[] });
    const settled = await Promise.allSettled(res.toolUses.map((b) => executeFunction(b.name, (b.input ?? {}) as Record<string, unknown>, ctx)));
    const results: Anthropic.ToolResultBlockParam[] = settled.map((s, i) => {
      const name = res.toolUses[i].name;
      if (s.status === "fulfilled") {
        if (s.value.render) renders.push(s.value.render);
        if (s.value.source) sources.push(...s.value.source);
        trace.toolOutputs.push({ name, response: s.value.data });
        return { type: "tool_result", tool_use_id: res.toolUses[i].id, content: JSON.stringify(s.value.data ?? null) };
      }
      const err = { error: String(s.reason) };
      trace.toolOutputs.push({ name, response: err });
      return { type: "tool_result", tool_use_id: res.toolUses[i].id, content: JSON.stringify(err), is_error: true };
    });
    messages.push({ role: "user", content: results });
    res = await call({ type: "auto" });
  }

  let text = textOf(res.msg);
  let firstTextAt = res.firstTextAt;
  if (text.trim() === "") {
    // I-2: 도구 없이 1회 강제 산문. 상한을 다 써 마지막 응답의 tool_use가 실행되지 않았으면 그 응답은 기록에 넣지 않는다
    // (Gemini 루프도 실행한 회차만 history에 넣는다).
    const retry = await call({ type: "none" });
    text = textOf(retry.msg);
    firstTextAt = retry.firstTextAt;
  }
  return { text, renders, sources: dedupeSources(sources).length, ttftMs: firstTextAt === null || text === "" ? undefined : firstTextAt - t0 };
}
