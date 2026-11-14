/**
 * 답변 모델 회사의 게이트와 세션 조립(E82 spec V23). 서버 전용.
 *
 * 키가 없는 회사는 목록에 없다(게이트 패턴: 선택지·요청·호출 전부 0). 순서는 앱 설정의 처음 값(OpenAI)이 앞이다.
 */
import { env, hasGeminiKey, hasOpenAiKey } from "@/lib/env";
import { getGeminiClient } from "@/lib/gemini/client";
import { createGoogleSession } from "./google";
import { createOpenAiSession } from "./openai";
import { toGeminiDeclarations, toOpenAiTools, type VergiliusToolSpec } from "./tools";
import type { VergiliusModelSession, VergiliusProvider } from "./types";

export function availableVergiliusProviders(): VergiliusProvider[] {
  const out: VergiliusProvider[] = [];
  if (hasOpenAiKey()) out.push("openai");
  if (hasGeminiKey()) out.push("google");
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
