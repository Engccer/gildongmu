/**
 * 실험판 「채팅 답변 모델」(E89 spec `2026-11-23-e89-chat-model-choice-design.md`)의 식별자·게이트·하루 상한·세션 조립. 서버 전용.
 *
 * 처음 값 Gemini는 이 표에 없다. 요청에 `chatModel`이 없거나 다섯 밖의 값이면 `/api/chat`은 종전 Gemini 경로를 그대로 탄다(정식판 봉인 1선).
 * 키가 없는 회사는 선택지에 서지 않는다(게이트 패턴: 목록·요청·호출 전부 0).
 */
import type { FunctionDeclaration } from "@google/genai";
import { env, hasAnthropicKey, hasOpenAiKey } from "@/lib/env";
import type { ChatHistoryTurn } from "./chat-model-error";
import { createAnthropicChatClient, createClaudeChatSession, toAnthropicChatTools, type ClaudeChatSettings } from "./claude-chat";
import type { ChatModelSession } from "./model-loop";
import { createOpenAiChatSession, toOpenAiChatTools, type OpenAiChatEffort } from "./openai-chat";

/**
 * 요청 값. 베르길리우스 「나들이 답변 모델」 식별자와 철자를 맞춘다(앱 이름 표·저장값 관례 공유). 앱이 저장하는 값이라 바꾸지 않는다.
 * 이 배열 순서가 `/api/chat/models` 응답 순서다(화면 순서는 앱 Kit `ChatAnswerModel.displayOrder`가 정한다).
 */
export const OPENAI_CHAT_MODELS = ["openai", "openai-luna"] as const;
export const CLAUDE_CHAT_MODELS = ["claude-opus", "claude-sonnet", "claude-haiku"] as const;
export const CHAT_MODEL_IDS = [...OPENAI_CHAT_MODELS, ...CLAUDE_CHAT_MODELS] as const;
export type OpenAiChatModelId = (typeof OPENAI_CHAT_MODELS)[number];
export type ClaudeChatModelId = (typeof CLAUDE_CHAT_MODELS)[number];
export type ChatModelId = (typeof CHAT_MODEL_IDS)[number];

/**
 * 모델 이름과 설정의 정본(spec C6). 이름은 2026-11-23 모델 목록 API로 확인했다. 설정은 E86 측정의 팔을 따른다:
 * Terra 추론 끔(11-15 리포트 권고 1순위), Luna 추론 낮음(안전 판독 8/9로 끔 7/9보다 낫다).
 * 바꾸면 앱 화면 이름(`ChatAnswerModel.displayName`)도 함께 고친다(가드 `chat-model-names.test.ts`).
 */
export const OPENAI_CHAT_SETTINGS: Record<OpenAiChatModelId, { model: string; effort: OpenAiChatEffort }> = {
  openai: { model: "gpt-6.1-terra", effort: "none" },
  "openai-luna": { model: "gpt-6-luna", effort: "low" },
};

/** Claude 셋: E86 11-14·11-15 측정의 「낮음」 팔(Sonnet은 생각을 `between_tools`로 끈다). */
export const CLAUDE_CHAT_SETTINGS: Record<ClaudeChatModelId, { model: string } & ClaudeChatSettings> = {
  "claude-opus": { model: "claude-opus-5-5", effort: "low" },
  "claude-sonnet": { model: "claude-sonnet-5-5", thinking: { type: "between_tools" }, effort: "low" },
  "claude-haiku": { model: "claude-haiku-5-5", effort: "low" },
};

/** 요청 전체 시한(spec C9). `/api/chat`의 `maxDuration`(120초) 안에서 실패 응답을 보낼 여유를 둔다. */
export const CHAT_MODEL_REQUEST_TIMEOUT_MS = 100_000;

function isOpenAi(id: ChatModelId): id is OpenAiChatModelId {
  return (OPENAI_CHAT_MODELS as readonly string[]).includes(id);
}

/** 요청 본문의 `chatModel`을 읽는다. 문자열이 아니거나 다섯 밖의 값이면 null(= 종전 Gemini 경로, spec C2). */
export function parseChatModel(raw: unknown): ChatModelId | null {
  return typeof raw === "string" && (CHAT_MODEL_IDS as readonly string[]).includes(raw) ? (raw as ChatModelId) : null;
}

/** 서버에 키가 있는 선택지. OpenAI 둘과 Claude 셋은 각각 한 키로 함께 서고 함께 빠진다. */
export function availableChatModels(): ChatModelId[] {
  const out: ChatModelId[] = [];
  if (hasOpenAiKey()) out.push(...OPENAI_CHAT_MODELS);
  if (hasAnthropicKey()) out.push(...CLAUDE_CHAT_MODELS);
  return out;
}

export interface ChatModelSessionInput {
  id: ChatModelId;
  systemInstruction: string;
  declarations: readonly FunctionDeclaration[];
  history: readonly ChatHistoryTurn[];
  signal?: AbortSignal;
}

/** 그 회사의 세션을 만든다. 키가 없으면 null(라우트가 502 `chat_model_unavailable`을 낸다). */
export function createChatModelSession(input: ChatModelSessionInput): ChatModelSession | null {
  if (isOpenAi(input.id)) {
    if (!hasOpenAiKey()) return null;
    const s = OPENAI_CHAT_SETTINGS[input.id];
    return createOpenAiChatSession({
      apiKey: env.GILDONGMU_OPENAI_API_KEY!,
      model: s.model,
      effort: s.effort,
      instructions: input.systemInstruction,
      tools: toOpenAiChatTools(input.declarations),
      history: input.history,
      signal: input.signal,
    });
  }
  if (!hasAnthropicKey()) return null;
  const { model, ...settings } = CLAUDE_CHAT_SETTINGS[input.id];
  return createClaudeChatSession({
    client: createAnthropicChatClient(env.ANTHROPIC_API_KEY!),
    model,
    settings,
    system: input.systemInstruction,
    tools: toAnthropicChatTools(input.declarations),
    history: input.history,
    signal: input.signal,
  });
}

// 비용 방어(spec C10): 기존 채팅 IP 상한(60초 10회) 뒤에, 다른 회사 경로에만 인스턴스 하루 상한을 더한다.
// 최악 Opus 질문당 약 2.3센트 × 150 = 인스턴스당 하루 약 3.5달러. ⚠ `rate-limit.ts` 머리 주석의 한계 그대로 인스턴스별이다.
export const CHAT_MODEL_DAILY_CAP = 150;

/** 다른 회사로 보내는 이력의 글자 합 상한. 하루 상한은 건수만 세므로 건당 입력을 여기서 묶는다(리뷰 2026-11-23). */
export const CHAT_MODEL_HISTORY_MAX_CHARS = 24_000;

/**
 * 클라이언트 이력을 다른 회사로 보낼 모양으로 고른다. 역할은 Gemini 경로처럼 `assistant`가 아니면 `user`로 접고
 * (`system`·`developer`로 운영자 지침을 끼우지 못하게), 오래된 턴부터 덜어 글자 합을 상한 안에 둔다. 마지막 턴은 항상 남기고 넘치면 자른다.
 */
export function boundChatHistory(raw: readonly { role?: unknown; text?: unknown }[], maxChars = CHAT_MODEL_HISTORY_MAX_CHARS): ChatHistoryTurn[] {
  const turns: ChatHistoryTurn[] = raw.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    text: typeof m.text === "string" ? m.text : "",
  }));
  const out: ChatHistoryTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (out.length === 0) {
      out.unshift({ ...t, text: t.text.slice(0, maxChars) });
      used = out[0].text.length;
      continue;
    }
    if (used + t.text.length > maxChars) break;
    out.unshift(t);
    used += t.text.length;
  }
  return out;
}
const KST_OFFSET_MS = 9 * 3_600_000;

/** 하루 상한(KST 자정 리셋, 다섯 모델 합산). 테스트가 새 인스턴스를 만든다. */
export function createChatModelBudget(cap = CHAT_MODEL_DAILY_CAP) {
  let day = -1;
  let used = 0;
  return {
    /** 한 칸 예약. 모델을 부르기 직전에만 쓴다(검증·키 게이트에서 떨어진 요청은 세지 않는다). 남은 칸이 없으면 false. */
    reserve(now: number): boolean {
      const d = Math.floor((now + KST_OFFSET_MS) / 86_400_000);
      if (d !== day) {
        day = d;
        used = 0;
      }
      if (used >= cap) return false;
      used += 1;
      return true;
    },
  };
}

const budget = createChatModelBudget();

export function reserveChatModelDaily(now: number): boolean {
  return budget.reserve(now);
}
