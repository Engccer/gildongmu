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
import {
  CLAUDE_VERGILIUS_PROVIDERS,
  OPENAI_VERGILIUS_PROVIDERS,
  type ClaudeVergiliusProvider,
  type OpenAiVergiliusProvider,
  type VergiliusModelSession,
  type VergiliusProvider,
} from "./types";

function isOpenAiProvider(p: VergiliusProvider): p is OpenAiVergiliusProvider {
  return (OPENAI_VERGILIUS_PROVIDERS as readonly string[]).includes(p);
}

function isClaudeProvider(p: VergiliusProvider): p is ClaudeVergiliusProvider {
  return (CLAUDE_VERGILIUS_PROVIDERS as readonly string[]).includes(p);
}

/**
 * 한 요청 전체의 시한. 회차마다의 20초 상한(어댑터)과 따로, 도구 왕복까지 합친 시간을 묶는다. 첫 문장 실패 기준(12초, V17)은
 * 앱이 따로 재고, 이 값은 그 뒤에도 이어지는 답이 모델을 오래 붙들어 과금하지 않게 하는 상한이다.
 */
export const VERGILIUS_REQUEST_TIMEOUT_MS = 25_000;

/** 요청 취소(앱이 연결을 끊음)와 전체 시한을 한 신호로 합친다. 이 신호가 어댑터의 모델 호출에 닿는다. */
export function vergiliusRequestSignal(requestSignal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([requestSignal, AbortSignal.timeout(timeoutMs)]);
}

export function availableVergiliusProviders(): VergiliusProvider[] {
  const out: VergiliusProvider[] = [];
  // OpenAI 둘(Terra·Luna)은 한 키로 함께 서고 함께 빠진다(Luna 2026-11-15 위원장 요청으로 추가). `OPENAI_VERGILIUS_PROVIDERS` 배열 순서(Terra 먼저)가 곧 이 목록 순서다(`routes.test.ts`가 잠근다).
  if (hasOpenAiKey()) out.push(...OPENAI_VERGILIUS_PROVIDERS);
  if (hasGeminiKey()) out.push("google");
  // Claude 셋은 한 키로 함께 서고 함께 빠진다(Opus·Sonnet 2026-11-14, Haiku 2026-11-15 위원장 요청으로 추가).
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
  if (isOpenAiProvider(input.provider)) {
    if (!hasOpenAiKey()) return null;
    return createOpenAiSession({
      apiKey: env.GILDONGMU_OPENAI_API_KEY!,
      provider: input.provider,
      instruction: input.instruction,
      material: input.material,
      tools: toOpenAiTools(input.tools),
      signal: input.signal,
    });
  }
  if (isClaudeProvider(input.provider)) {
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
