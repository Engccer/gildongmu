/**
 * 채팅 Claude 세션(E89 spec C7) — 공식 SDK `messages.stream().finalMessage()`. React/Next 비의존, `client` 주입형.
 *
 * 하네스 러너(`src/__ab__/claude-runner.ts`)와 같은 요청 모양에서 계측을 뺐다:
 * - 생각 설정은 모델마다 다르다(claude-api 스킬 2026-11-23 판, 베르길리우스 어댑터와 같다). Opus 5.5·Haiku 5.5는 `thinking`을 보내지 않고
 *   effort `low`, Sonnet 5.5는 `{type:"between_tools"}` + effort `low`(`between_tools`는 다른 필드와 함께 보내면 400).
 * - 캐시: system 끝에 명시 지점(도구 + 지침 고정 접두) + 요청 최상위 자동 지점(자라는 대화 꼬리). 출력은 같고 비용만 바뀐다.
 * - 도구 선택은 `auto`(열린 회차)와 `none`(닫힌 회차)뿐이다(Opus·Sonnet은 강제 선택이 400). 닫힌 회차도 선언은 그대로 둔다.
 * - 도구를 부른 회차의 응답 내용은 받은 그대로 이력에 넣는다(생각 블록은 모델과 대화에 묶여 있어 바꾸면 버려지거나 400).
 * - 실패한 도구 결과에는 `is_error: true`를 붙인다.
 * - `stop_reason`은 `end_turn`·`tool_use`만 정상이다. 나머지(`refusal`·`max_tokens`·…)는 실패이고, 서버 측 `fallbacks`는 쓰지 않는다
 *   (위원장이 고른 모델이 답한다, spec C4).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { FunctionDeclaration } from "@google/genai";
import { ChatModelError, type ChatHistoryTurn } from "./chat-model-error";
import type { ChatModelSession, ChatRoundResult, ChatToolCall, ChatToolOutcome } from "./model-loop";

export interface ClaudeChatSettings {
  thinking?: Anthropic.ThinkingConfigParam;
  effort: NonNullable<Anthropic.OutputConfig["effort"]>;
}

/** Gemini 함수 선언 → Anthropic 사용자 정의 도구. 스키마는 깊은 복사만 하고 손대지 않는다(spec C8). */
export function toAnthropicChatTools(decls: readonly FunctionDeclaration[]): Anthropic.Tool[] {
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

/** 회차 하나의 상한(SDK가 응답 머리까지 재는 시한, spec C9). */
export const CLAUDE_CHAT_ROUND_TIMEOUT_MS = 45_000;
const MAX_TOKENS = 16_000;

/** 서버 전용 SDK 클라이언트. 재시도는 1회만(대기가 요청 시한 100초에 숨지 않게). */
export function createAnthropicChatClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: CLAUDE_CHAT_ROUND_TIMEOUT_MS, maxRetries: 1 });
}

/** 테스트에서 가짜 SDK를 넣을 수 있게 세션이 쓰는 표면만 좁힌다. */
export interface ClaudeChatClientLike {
  messages: {
    stream(
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ): { finalMessage(): Promise<Anthropic.Message> };
  };
}

export interface ClaudeChatSessionOptions {
  client: ClaudeChatClientLike;
  model: string;
  settings: ClaudeChatSettings;
  system: string;
  tools: Anthropic.Tool[];
  history: readonly ChatHistoryTurn[];
  signal?: AbortSignal;
}

const STOP_KIND: Record<string, string> = {
  refusal: "claude stop refusal",
  max_tokens: "claude stop max_tokens",
  model_context_window_exceeded: "claude stop context",
  pause_turn: "claude stop pause_turn",
  stop_sequence: "claude stop stop_sequence",
};

function toError(e: unknown): unknown {
  if (e instanceof ChatModelError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new ChatModelError("claude aborted");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ChatModelError("claude timeout");
  if (e instanceof Anthropic.APIConnectionError) return new ChatModelError("claude connection");
  if (e instanceof Anthropic.APIError) return new ChatModelError("claude messages", e.status ?? null);
  if (e instanceof Anthropic.AnthropicError) return new ChatModelError("claude stream");
  return e;
}

function toArgs(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

export function createClaudeChatSession(opts: ClaudeChatSessionOptions): ChatModelSession {
  // 빈 글은 400이고, 첫 메시지는 user여야 한다(앞머리 assistant만 뺀다, spec C14).
  const turns = opts.history.filter((t) => t.text.trim() !== "");
  while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }];
  let last: Anthropic.Message | null = null;

  return {
    async round(toolsOpen: boolean): Promise<ChatRoundResult> {
      const params: Anthropic.MessageStreamParams = {
        model: opts.model,
        max_tokens: MAX_TOKENS,
        system,
        tools: opts.tools,
        tool_choice: toolsOpen ? { type: "auto" } : { type: "none" },
        messages: [...messages],
        cache_control: { type: "ephemeral" },
        ...(opts.settings.thinking ? { thinking: opts.settings.thinking } : {}),
        output_config: { effort: opts.settings.effort },
      };
      let msg: Anthropic.Message;
      try {
        msg = await opts.client.messages.stream(params, opts.signal ? { signal: opts.signal } : undefined).finalMessage();
      } catch (e) {
        throw toError(e);
      }
      const stop = msg.stop_reason;
      if (stop !== "end_turn" && stop !== "tool_use") {
        throw new ChatModelError(stop ? (STOP_KIND[stop] ?? "claude stop other") : "claude stop null");
      }
      const calls: ChatToolCall[] = msg.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, args: toArgs(b.input) }));
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      last = msg;
      return { text, calls };
    },

    addToolResults(outcomes: ChatToolOutcome[]) {
      if (!last) return;
      messages.push({ role: "assistant", content: last.content as Anthropic.ContentBlockParam[] });
      const results: Anthropic.ToolResultBlockParam[] = outcomes.map((o) => ({
        type: "tool_result",
        tool_use_id: o.call.id,
        content: JSON.stringify(o.response),
        ...(o.ok ? {} : { is_error: true }),
      }));
      messages.push({ role: "user", content: results });
    },
  };
}
