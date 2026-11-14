/**
 * 답변 모델 회사의 게이트와 세션 조립(E82 spec V23). 서버 전용.
 *
 * 키가 없는 회사와 닫아 둔 회사는 목록에 없다(게이트 패턴: 선택지·요청·호출 전부 0). 순서는 앱 설정의 처음 값(OpenAI)이 앞이다.
 */
import { env, hasAnthropicKey, hasGeminiKey, hasOpenAiKey } from "@/lib/env";
import { getGeminiClient } from "@/lib/gemini/client";
import { createAnthropicClient, createClaudeSession } from "./claude";
import { createGoogleSession } from "./google";
import { createOpenAiSession } from "./openai";
import { toAnthropicTools, toGeminiDeclarations, toOpenAiTools, type VergiliusToolSpec } from "./tools";
import { CLAUDE_VERGILIUS_PROVIDERS, type VergiliusModelSession, type VergiliusProvider } from "./types";

/**
 * 한 요청 전체의 시한. 회차마다의 20초 상한(어댑터)과 따로, 도구 왕복까지 합친 시간을 묶는다. 걷는 사람은 8초 안에 첫 문장이
 * 없으면 실패 문장을 듣는다(V17) — 그 뒤로 모델을 오래 붙들어 과금할 이유가 없다.
 */
export const VERGILIUS_REQUEST_TIMEOUT_MS = 25_000;

/** 요청 취소(앱이 연결을 끊음)와 전체 시한을 한 신호로 합친다. 이 신호가 어댑터의 모델 호출에 닿는다. */
export function vergiliusRequestSignal(requestSignal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([requestSignal, AbortSignal.timeout(timeoutMs)]);
}

export function availableVergiliusProviders(): VergiliusProvider[] {
  const out: VergiliusProvider[] = [];
  if (hasOpenAiKey()) out.push("openai");
  if (hasGeminiKey()) out.push("google");
  // Claude 둘은 한 키로 함께 서고 함께 빠진다(2026-11-14 위원장 요청으로 추가).
  if (hasAnthropicKey()) out.push(...CLAUDE_VERGILIUS_PROVIDERS);
  return out;
}

export interface VergiliusSessionInput {
  provider: VergiliusProvider;
  instruction: string;
  material: string;
  tools: readonly VergiliusToolSpec[];
  signal?: AbortSignal;
}

/** 그 회사의 세션을 만든다. 키가 없으면 null(라우트가 게이트 응답을 낸다). */
export function createVergiliusSession(input: VergiliusSessionInput): VergiliusModelSession | null {
  if (input.provider === "openai") {
    if (!hasOpenAiKey()) return null;
    return createOpenAiSession({
      apiKey: env.OPENAI_API_KEY!,
      instruction: input.instruction,
      material: input.material,
      tools: toOpenAiTools(input.tools),
      signal: input.signal,
    });
  }
  if (input.provider === "claude-opus" || input.provider === "claude-sonnet") {
    if (!hasAnthropicKey()) return null;
    return createClaudeSession({
      client: createAnthropicClient(env.ANTHROPIC_API_KEY!),
      provider: input.provider,
      instruction: input.instruction,
      material: input.material,
      tools: toAnthropicTools(input.tools),
      signal: input.signal,
    });
  }
  const ai = getGeminiClient();
  if (!ai) return null;
  return createGoogleSession({
    ai,
    instruction: input.instruction,
    material: input.material,
    declarations: toGeminiDeclarations(input.tools),
    signal: input.signal,
  });
}
