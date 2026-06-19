// Gemini 클라이언트 래퍼 (React/Next 비의존, 서버 전용)
import { GoogleGenAI } from "@google/genai";
import { env, hasGeminiKey } from "@/lib/env";

// dodo-planet MODELS.chat과 동일 모델 (function-calling eval 96%, GA)
export const GEMINI_MODEL = "gemini-3.5-flash";

/** lazy 캐시 — 동일 프로세스에서 클라이언트 인스턴스를 재사용한다 */
let cached: GoogleGenAI | null = null;

/**
 * GEMINI_API_KEY가 있으면 GoogleGenAI 클라이언트를 반환하고,
 * 없으면 null을 반환한다 (다른 env 게이트 함수와 동형).
 */
export function getGeminiClient(): GoogleGenAI | null {
  if (!hasGeminiKey()) return null;
  if (!cached) cached = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY! });
  return cached;
}
