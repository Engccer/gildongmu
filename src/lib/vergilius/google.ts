/**
 * Google 어댑터 — 저장소의 Gemini 클라이언트(`@google/genai`)로 `generateContentStream`을 부른다(E82 spec V23·V24).
 * `ai`는 주입형이다(테스트 가능, 채팅 `agent-loop.ts`와 같은 관례). React/Next 비의존.
 *
 * 계약:
 * - **모델 회차의 parts는 받은 그대로 이력에 넣는다.** Gemini 3 계열은 도구 호출 part에 생각 서명(`thoughtSignature`)을
 *   실어 보내고, 다음 요청에 그 서명이 빠지면 400이다. 스트림 조각을 합칠 때 part 객체를 다시 만들지 않는다.
 * - 도구 결과의 **짝은 이름과 순서**다(`functionResponse.name`, 호출에 `id`가 있으면 그것도 싣는다). 한 회차의 결과는
 *   호출 순서 그대로 한 `user` content에 담는다.
 * - 생각 part(`thought: true`)는 글로 내보내지 않는다.
 * - 마지막 `finishReason`이 `STOP`이 아니면 던진다(토큰 상한·안전 차단·끊긴 스트림). OpenAI 어댑터의 `incomplete`·
 *   끝맺음 없는 스트림 처리와 같은 3-state다: 잘린 글을 답으로 읽히지 않는다.
 */
import { FinishReason, FunctionCallingConfigMode, ThinkingLevel } from "@google/genai";
import type { Content, FunctionDeclaration, GoogleGenAI, Part } from "@google/genai";
import { VergiliusModelError } from "./types";
import type {
  VergiliusModelSession,
  VergiliusRoundOptions,
  VergiliusRoundResult,
  VergiliusToolCall,
  VergiliusToolOutcome,
} from "./types";

// 2026-11-15 모델 목록 API(`GET /v1beta/models`)에서 확인. 처음 값 `gemini-3.5-flash-lite`(생각 최소)는 카페 질문에 다른 종류를 섞고
// 버스 번호를 한글로 풀다 없는 번호를 냈다. 3.8 Flash(생각 낮음)는 같은 22회에서 세 오류 0건, 첫 문장 가장 느린 회차 5.3초였다
// (`docs/evals/2026-11-15-vergilius-answer-quality-remeasure.md` §8). 3.8 Flash는 생각 「최소」를 받지 않는다(400).
// 채팅의 `GEMINI_MODEL`(3.6-flash)과 따로 둔다. 바꿀 때는 iOS Kit의 화면 이름도 고친다(`vergilius-model-names.test.ts`).
export const GOOGLE_VERGILIUS_MODEL = "gemini-3.8-flash";

const ROUND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 600;

export interface GoogleSessionOptions {
  ai: Pick<GoogleGenAI, "models">;
  instruction: string;
  /** 첫 사용자 글(재료 + 질문). */
  material: string;
  declarations: FunctionDeclaration[];
  model?: string;
  signal?: AbortSignal;
}

export function createGoogleSession(opts: GoogleSessionOptions): VergiliusModelSession {
  const model = opts.model ?? GOOGLE_VERGILIUS_MODEL;
  const contents: Content[] = [{ role: "user", parts: [{ text: opts.material }] }];

  return {
    async round(roundOpts: VergiliusRoundOptions): Promise<VergiliusRoundResult> {
      const timeout = AbortSignal.timeout(ROUND_TIMEOUT_MS);
      const stream = await opts.ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: opts.instruction,
          tools: [{ functionDeclarations: opts.declarations }],
          // 도구를 닫은 회차도 선언은 그대로 둔다(이력의 호출이 가리키는 도구가 요청에 있어야 한다).
          toolConfig: {
            functionCallingConfig: {
              mode: roundOpts.tools ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE,
            },
          },
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
        },
      });

      let text = "";
      const calls: VergiliusToolCall[] = [];
      const modelParts: Part[] = [];
      let finishReason: FinishReason | undefined;

      for await (const chunk of stream) {
        finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;
        const parts: Part[] = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          modelParts.push(part);
          if (part.functionCall) {
            roundOpts.onCall();
            calls.push({
              id: part.functionCall.id ?? null,
              name: part.functionCall.name ?? "",
              args: (part.functionCall.args ?? {}) as Record<string, unknown>,
            });
          } else if (typeof part.text === "string" && part.thought !== true) {
            text += part.text;
            roundOpts.onText(part.text);
          }
        }
      }

      if (finishReason === undefined) throw new VergiliusModelError("google stream ended early");
      // 값은 SDK enum의 고정 낱말이다(MAX_TOKENS·SAFETY…).
      if (finishReason !== FinishReason.STOP) throw new VergiliusModelError(`google finish ${finishReason}`);

      if (calls.length > 0) contents.push({ role: "model", parts: modelParts });
      return { text, calls };
    },

    pushToolResults(outcomes: VergiliusToolOutcome[]): void {
      contents.push({
        role: "user",
        parts: outcomes.map((o) => ({
          functionResponse: {
            ...(o.call.id !== null ? { id: o.call.id } : {}),
            name: o.call.name,
            response: o.response,
          },
        })),
      });
    },
  };
}
