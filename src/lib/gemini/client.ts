// Gemini 클라이언트 래퍼 (React/Next 비의존, 서버 전용)
import { GoogleGenAI } from "@google/genai";
import { env, hasGeminiKey } from "@/lib/env";

// 2026-07-31 3.5-flash→3.6-flash 교체. 18도구 실호출 A/B 근거는 PROGRESS.md 채팅 행
// (도구 절제 우세·다중 라운드 지연 -36%·thinking 토큰 -30.7%). SDK 무변경.
//
// ⚠ 2026-08-15 gemini-3.7-flash 실호출 A/B 결과 **교체 기각**(더 최신이라고 올리지 말 것).
// 비용·지연은 동률인데 "도구가 주지 않은 장소 특징을 말하지 마라" 축에서 5/5 회귀했다
// (search_web으로 우회해 매장 분위기·좌석·화장실 위치를 서술 — 시각장애 사용자가
// 검증할 수 없는 정보다). 재평가 트리거·수치는 docs/BACKLOG.md C5, 하네스는 src/__ab__.
// (2026-08-25부터 그 날조 축은 사람이 읽는 judge가 아니라 `src/__ab__/grounding.ts` 엔티티 대조가 자동 판정한다.)
//
// ⚠ 2026-09-04 gemini-3.8-flash도 **교체 기각**. 25케이스×3반복×2모델 실호출에서 safety pass^3이
// 3/5 → **0/5**로 무너졌고 capability 신규 통과는 **0건**이었다(docs/evals/2026-09-04-model-ab-3.8-flash.md).
// 뒤집힌 4케이스(09·37·42·43)의 기제가 하나다 — 3.8은 도구를 더 부르고(134→181회) 그 초과분이
// `search_web`·`search_places` 우회라, 09에서 3.7 기각 때와 같은 문장("화장실은 매장 외부 상가 시설을
// 이용합니다")이 나왔다. 이것은 버그가 아니라 3.8의 광고된 설계("works harder, calling tools
// iteratively")가 이 도메인에서 나타나는 형태이므로 다음 마이너 버전에서 저절로 낫지 않는다.
// 비용도 +15.9%(원인은 thinking이 아니라 라운드 증가에 따른 input 토큰 +19.7%). 재평가는 BACKLOG C5.
export const GEMINI_MODEL = "gemini-3.6-flash";

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
