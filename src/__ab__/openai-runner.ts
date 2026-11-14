/**
 * OpenAI 채팅 모델 A/B 러너(E86 채팅 후보 확장). **하네스 전용**이다 — 운영 채팅 경로(`/api/chat`·`runAgentLoop`)는 바꾸지 않는다.
 *
 * 모델 외 변수가 섞이지 않게 Gemini·Claude 러너와 같은 재료를 쓴다:
 * - instructions: `buildChatSystemInstruction` 정본 문자열 그대로(`model-ab.spec.ts`가 넘긴다)
 * - 도구 선언: `availableDeclarations`의 `parametersJsonSchema`를 **그대로** `parameters`로 옮긴다(설명·enum·required 보존).
 *   ⚠ Responses API는 함수 도구의 `strict`가 기본으로 켜진다. Gemini·Claude 쪽에 없는 스키마 강제라 변수가 되므로 `strict: false`를 명시한다.
 * - 도구 실행: `executeFunction`(router) 그대로, `Promise.allSettled` 병렬, 실패는 `{ error: String(reason) }`.
 * - 루프 상한: `maxIterations` 6, 루프 뒤 답이 비면 도구를 닫고(`tool_choice: "none"`) 1회 더(I-2). 선언 목록은 그대로 둔다
 *   (이력의 `function_call` 항목이 가리키는 도구가 요청에 있어야 한다).
 *
 * OpenAI 쪽에만 있는 것:
 * - 전송은 Responses API(`POST /v1/responses`, 비스트리밍)를 `fetch`로 부른다. 공식 모델 문서(2026-11-15)가 Terra의 도구 호출은
 *   Responses API만 받는다고 적었다. 저장하지 않으므로(`store: false`) 매 회차 이력 전량을 다시 보낸다. 응답의 `output` 항목을
 *   손대지 않고 이력에 붙이고(append-only), 추론을 켠 설정은 추론 항목을 암호화본째 받아(`include`) 되돌린다.
 * - 운영 채팅은 답을 완료 시점에 한 번 보내므로 체감은 총지연이다. 그래서 스트리밍하지 않고 첫 글자 시각은 재지 않는다.
 * - 프롬프트 캐싱은 GPT-5.6 이후 자동이다(기본 30분). 적중·쓰기는 `input_tokens_details.cached_tokens`·`cache_write_tokens`로 기록한다.
 * - `status`가 `completed`가 아니거나(`incomplete`·`failed`) 답에 `refusal`이 있으면 그 세션은 실패다(Claude 러너의 정지 사유 실패와
 *   같은 쪽. Gemini 러너는 `finishReason`으로 실패를 가르지 않으므로 비대칭이다 — 리포트에서 따로 읽는다).
 * - 재시도 없음(Gemini·Claude와 같다). 일시 오류는 그 세션의 실패로 남는다.
 */
import type { FunctionDeclaration } from "@google/genai";
import { executeFunction } from "@/lib/chat/router";
import { dedupeSources } from "@/lib/chat/sources";
import type { ExecutionContext, SourceAttribution } from "@/lib/chat/types";
import type { ToolOutput } from "./grounding";

export type OpenAiEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OpenAiSpec {
  model: string;
  /** 없으면 보내지 않는다(그 모델의 API 기본값, 2026-11-15 공식 문서 기준 medium). */
  effort: OpenAiEffort | null;
}

const EFFORTS: readonly OpenAiEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];

export function isOpenAiModel(spec: string): boolean {
  return spec.startsWith("gpt-");
}

/**
 * 실행기 모델 표기 `gpt-<모델>[@<effort>]`를 가른다. 예: `gpt-6.1-terra@none`, `gpt-6-luna@low`.
 * 모르는 effort·접미사는 throw한다(오타 하나로 다른 설정의 측정이 같은 이름으로 기록되는 것을 막는다).
 */
export function parseOpenAiSpec(spec: string): OpenAiSpec {
  if (spec.includes("+")) throw new Error(`OpenAI 표기는 + 접미사를 받지 않는다: ${spec}`);
  const at = spec.indexOf("@");
  const model = at < 0 ? spec : spec.slice(0, at);
  const effortRaw = at < 0 ? null : spec.slice(at + 1);
  if (effortRaw !== null && !EFFORTS.includes(effortRaw as OpenAiEffort)) throw new Error(`모르는 reasoning effort: ${effortRaw}`);
  return { model, effort: effortRaw as OpenAiEffort | null };
}

export interface OpenAiFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: false;
}

/**
 * Gemini 함수 선언 → Responses API 함수 도구. 스키마는 깊은 복사만 하고 손대지 않는다.
 * Gemini 고유 `parameters`(Type enum 스키마)는 옮기지 않고 throw한다(Claude 러너와 같은 이유: 조용히 빈 스키마가 되면 측정이 오염된다).
 */
export function toOpenAiTools(decls: FunctionDeclaration[]): OpenAiFunctionTool[] {
  return decls.map((d) => {
    if (!d.name) throw new Error("이름 없는 선언");
    if (d.parameters) throw new Error(`${d.name}: parameters(Gemini Type 스키마)는 변환하지 않는다 — parametersJsonSchema로 선언할 것`);
    const schema = d.parametersJsonSchema
      ? (structuredClone(d.parametersJsonSchema) as Record<string, unknown>)
      : { type: "object", properties: {} };
    if (schema.type !== "object") throw new Error(`${d.name}: 최상위 스키마가 object가 아니다`);
    return { type: "function", name: d.name, ...(d.description ? { description: d.description } : {}), parameters: schema, strict: false };
  });
}

/** Responses API 응답 중 러너가 읽는 부분만. */
export interface OpenAiResponse {
  status: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output: Record<string, unknown>[];
  usage?: {
    input_tokens: number;
    input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    output_tokens: number;
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

/** 테스트에서 가짜를 넣을 수 있게 요청 한 번을 함수로 좁힌다. */
export type OpenAiCall = (body: Record<string, unknown>) => Promise<OpenAiResponse>;

const RESPONSES_URL = "https://api.openai.com/v1/responses";
/** 한 회차 상한. 매달린 요청이 실행 전체를 붙들지 않게 한다(넘기면 그 세션의 실패). */
const ROUND_TIMEOUT_MS = 180_000;

export function openAiFetchCall(apiKey: string, fetchImpl: typeof fetch = fetch): OpenAiCall {
  return async (body) => {
    const res = await fetchImpl(RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ROUND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`openai responses ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as OpenAiResponse;
  };
}

export interface OpenAiRoundStat {
  ms: number;
  /** 세션 시작 기준 이 회차의 시작 시각(ms). */
  startedAt: number;
  status: string;
  /** 캐시 포함 입력 총량. Gemini `promptTokenCount`와 같은 뜻. */
  promptTokens: number;
  uncachedInputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** 추론을 뺀 출력. */
  outputTokens: number;
  thoughtTokens: number;
  toolCalls: string[];
  toolArgs: { name: string; args: Record<string, unknown> }[];
}

export class OpenAiStopError extends Error {
  constructor(
    readonly status: string,
    readonly detail: string,
  ) {
    super(`status=${status}${detail ? ` (${detail})` : ""}`);
  }
}

export interface OpenAiLoopOptions {
  call: OpenAiCall;
  spec: OpenAiSpec;
  systemInstruction: string;
  tools: OpenAiFunctionTool[];
  /** 사용자 발화들(케이스의 `turns`). */
  turns: string[];
  ctx: ExecutionContext;
  maxIterations?: number;
  maxOutputTokens?: number;
}

export interface OpenAiLoopResult {
  text: string;
  renders: { type: string }[];
  sources: number;
}

export interface OpenAiLoopTrace {
  rounds: OpenAiRoundStat[];
  toolOutputs: ToolOutput[];
}

interface FunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

function parseArguments(raw: string): Record<string, unknown> {
  if (raw.trim() === "") return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    // 깨진 인자는 빈 인자로 실행부에 넘긴다(실행부가 오류로 답한다). Gemini·Claude는 SDK가 객체로 주므로 이 갈래가 없다.
    return {};
  }
}

/** 답 글과 거절 여부. 메시지 항목의 `output_text`만 잇는다. */
function textOf(r: OpenAiResponse): { text: string; refusal: string | null } {
  let text = "";
  let refusal: string | null = null;
  for (const item of r.output) {
    if (item.type !== "message") continue;
    for (const c of (item.content as Record<string, unknown>[] | undefined) ?? []) {
      if (c.type === "output_text") text += String(c.text ?? "");
      else if (c.type === "refusal") refusal = String(c.refusal ?? "");
    }
  }
  return { text, refusal };
}

/**
 * `runAgentLoop`(src/lib/chat/agent-loop.ts)의 OpenAI판 거울. 루프 모양을 바꾸면 그쪽과 `claude-runner.ts`를 함께 본다.
 * 계측은 `trace`에 쌓고, 실패(상태·거절·API 오류)는 throw한다 — 호출부가 지금까지의 trace로 실패 결과를 적는다.
 */
export async function runOpenAiAgentLoop(opts: OpenAiLoopOptions, trace: OpenAiLoopTrace): Promise<OpenAiLoopResult> {
  const { call, spec, systemInstruction, tools, ctx } = opts;
  const maxIterations = opts.maxIterations ?? 6;
  const t0 = Date.now();
  const input: Record<string, unknown>[] = opts.turns.map((t) => ({ role: "user", content: t }));
  const renders: { type: string }[] = [];
  const sources: SourceAttribution[] = [];
  const reasoningOn = spec.effort !== "none";

  const round = async (toolChoice: "auto" | "none") => {
    const body: Record<string, unknown> = {
      model: spec.model,
      instructions: systemInstruction,
      input: [...input],
      tools,
      tool_choice: toolChoice,
      parallel_tool_calls: true,
      store: false,
      max_output_tokens: opts.maxOutputTokens ?? 32_000,
      ...(spec.effort ? { reasoning: { effort: spec.effort } } : {}),
      // 저장하지 않는 대화에서 추론 항목을 다음 회차로 넘기려면 암호화본이 있어야 한다.
      ...(reasoningOn ? { include: ["reasoning.encrypted_content"] } : {}),
    };
    const startedAt = Date.now();
    const res = await call(body);
    const calls = res.output.filter((o): o is FunctionCallItem & Record<string, unknown> => o.type === "function_call");
    const u = res.usage;
    const cacheRead = u?.input_tokens_details?.cached_tokens ?? 0;
    const cacheWrite = u?.input_tokens_details?.cache_write_tokens ?? 0;
    const reasoning = u?.output_tokens_details?.reasoning_tokens ?? 0;
    trace.rounds.push({
      ms: Date.now() - startedAt,
      startedAt: startedAt - t0,
      status: res.status,
      promptTokens: u?.input_tokens ?? 0,
      uncachedInputTokens: (u?.input_tokens ?? 0) - cacheRead - cacheWrite,
      cacheWriteTokens: cacheWrite,
      cacheReadTokens: cacheRead,
      outputTokens: (u?.output_tokens ?? 0) - reasoning,
      thoughtTokens: reasoning,
      toolCalls: calls.map((c) => c.name),
      toolArgs: calls.map((c) => ({ name: c.name, args: parseArguments(c.arguments) })),
    });
    if (res.status !== "completed") {
      throw new OpenAiStopError(res.status, res.incomplete_details?.reason ?? res.error?.message ?? "");
    }
    const { text, refusal } = textOf(res);
    if (refusal !== null) throw new OpenAiStopError("refusal", refusal.slice(0, 100));
    return { res, calls, text };
  };

  let r = await round("auto");
  for (let iter = 0; iter < maxIterations; iter++) {
    if (r.calls.length === 0) break;
    // 추론·메시지·도구 호출 항목을 바꾸지 않고 붙인다(append-only).
    input.push(...r.res.output);
    const settled = await Promise.allSettled(r.calls.map((c) => executeFunction(c.name, parseArguments(c.arguments), ctx)));
    settled.forEach((s, i) => {
      const { name, call_id } = r.calls[i];
      let response: unknown;
      if (s.status === "fulfilled") {
        if (s.value.render) renders.push(s.value.render);
        if (s.value.source) sources.push(...s.value.source);
        response = s.value.data ?? null;
      } else {
        response = { error: String(s.reason) };
      }
      trace.toolOutputs.push({ name, response });
      input.push({ type: "function_call_output", call_id, output: JSON.stringify(response) });
    });
    r = await round("auto");
  }

  let text = r.text;
  if (text.trim() === "") {
    // I-2: 도구를 닫고 1회 강제 산문. 상한을 다 써 마지막 응답의 function_call이 실행되지 않았으면 그 응답은 이력에 넣지 않는다
    // (Gemini 루프도 실행한 회차만 history에 넣는다).
    text = (await round("none")).text;
  }
  return { text, renders, sources: dedupeSources(sources).length };
}
