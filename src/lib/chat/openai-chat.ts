/**
 * 채팅 OpenAI 세션(E89 spec C7) — Responses API(`POST /v1/responses`, 비스트리밍)를 `fetch`로 부른다. React/Next 비의존.
 *
 * 하네스 러너(`src/__ab__/openai-runner.ts`)와 같은 요청 모양에서 계측을 뺐다:
 * - `store: false`라 회차마다 이력 전량을 다시 보낸다. 응답의 `output` 항목은 손대지 않고 이력에 붙인다(append-only).
 * - 추론을 켠 설정(`effort`가 `none`이 아님)은 추론 항목을 암호화본째 받아(`include`) 다음 회차로 되돌린다.
 * - 함수 도구는 `strict: false`를 명시한다(Responses API 기본이 켬이고, 채팅 선언은 선택 인자를 쓴다).
 * - 닫힌 회차는 `tool_choice: "none"`이고 선언은 그대로 둔다(이력의 `function_call`이 가리키는 도구가 요청에 있어야 한다).
 * - `status`가 `completed`가 아니거나 답에 `refusal`이 있으면 실패다. 다른 모델로 돌리지 않는다(spec C4).
 */
import type { FunctionDeclaration } from "@google/genai";
import { ChatModelError, type ChatHistoryTurn } from "./chat-model-error";
import type { ChatModelSession, ChatRoundResult, ChatToolCall, ChatToolOutcome } from "./model-loop";

export type OpenAiChatEffort = "none" | "low";

export interface OpenAiChatTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: false;
}

/** Gemini 함수 선언 → Responses API 함수 도구. 스키마는 깊은 복사만 하고 손대지 않는다(spec C8). */
export function toOpenAiChatTools(decls: readonly FunctionDeclaration[]): OpenAiChatTool[] {
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

const RESPONSES_URL = "https://api.openai.com/v1/responses";
/** 회차 하나의 상한(spec C9). 요청 전체 시한은 호출부 신호가 묶는다. */
export const OPENAI_CHAT_ROUND_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 16_000;

export interface OpenAiChatSessionOptions {
  apiKey: string;
  model: string;
  effort: OpenAiChatEffort;
  instructions: string;
  tools: OpenAiChatTool[];
  history: readonly ChatHistoryTurn[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

interface OpenAiResponseBody {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Record<string, unknown>[];
}

/** 객체로 읽히면 그 객체, 아니면 빈 인자(실행부가 「목적지가 필요합니다」 같은 오류로 답한다). */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createOpenAiChatSession(opts: OpenAiChatSessionOptions): ChatModelSession {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const input: Record<string, unknown>[] = opts.history
    .filter((t) => t.text.trim() !== "")
    .map((t) => ({ role: t.role, content: t.text }));
  const reasoningOn = opts.effort !== "none";
  let lastOutput: Record<string, unknown>[] = [];

  return {
    async round(toolsOpen: boolean): Promise<ChatRoundResult> {
      const body = {
        model: opts.model,
        instructions: opts.instructions,
        input: [...input],
        tools: opts.tools,
        tool_choice: toolsOpen ? "auto" : "none",
        parallel_tool_calls: true,
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: opts.effort },
        ...(reasoningOn ? { include: ["reasoning.encrypted_content"] } : {}),
      };
      const signals = [AbortSignal.timeout(OPENAI_CHAT_ROUND_TIMEOUT_MS)];
      if (opts.signal) signals.push(opts.signal);
      let res: Response;
      try {
        res = await fetchImpl(RESPONSES_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.any(signals),
        });
      } catch (e) {
        throw new ChatModelError(e instanceof Error && e.name === "TimeoutError" ? "openai timeout" : "openai connection");
      }
      // 오류 본문은 읽지 않는다(요청 글이 되비칠 수 있어 로그에 싣지 않는다, spec C12).
      if (!res.ok) throw new ChatModelError("openai responses", res.status);
      const json = (await res.json()) as OpenAiResponseBody;
      if (json.status !== "completed") {
        throw new ChatModelError(json.status === "incomplete" ? "openai incomplete" : "openai not completed");
      }
      const output = json.output ?? [];
      let text = "";
      const calls: ChatToolCall[] = [];
      for (const item of output) {
        if (item.type === "function_call") {
          calls.push({ id: String(item.call_id), name: String(item.name), args: parseArguments(item.arguments) });
        } else if (item.type === "message") {
          for (const c of (item.content as Record<string, unknown>[] | undefined) ?? []) {
            if (c.type === "output_text") text += String(c.text ?? "");
            else if (c.type === "refusal") throw new ChatModelError("openai refusal");
          }
        }
      }
      lastOutput = output;
      return { text, calls };
    },

    addToolResults(outcomes: ChatToolOutcome[]) {
      input.push(...lastOutput);
      for (const o of outcomes) {
        input.push({ type: "function_call_output", call_id: o.call.id, output: JSON.stringify(o.response) });
      }
    },
  };
}
