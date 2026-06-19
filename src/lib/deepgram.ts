import type { SttLocale } from "./stt-validate";

/**
 * Deepgram STT 응답을 앱 공통 형태로 정규화한다(React/Next 비의존).
 * 전사 텍스트가 비면 null(인식 실패) — 가짜 결과를 만들지 않는다.
 */
export interface Transcript {
  text: string;
  language_code: string;
  confidence: number;
}

/**
 * STT 요청 파라미터 — 앱이 로케일을 알므로 자동감지(detect_language) 대신
 * `language`를 명시한다(latent→deterministic).
 *
 * ⚠ 실측 결함(2026-06-19): `detect_language=true`는 한국어 발화를 베트남어(vi,
 * confidence 0.92)로 오인식해 빈 전사("")를 반환했다 → 받아쓰기 전면 실패. dodo-planet
 * (다국어 자동감지)에서 그대로 수입한 설정이 화근. gildongmu는 next-intl 로케일을
 * 알고 라우트에 locale까지 넘기므로 ko/en을 직접 지정해 오인식 경로 자체를 제거한다.
 *
 * 모델은 현행 `nova-3` — `nova-2-conversationalai`는 deprecated되어 Deepgram이
 * 조용히 nova-3로 라우팅하며, ko 정확도도 nova-3가 우위였다(실측: nova-2 "길동 맛집
 * 검색" vs nova-3 "강동구 길동 맛집 검색"). nova-3는 ko/en/es/fr/it를 모두 인식하므로
 * 외국인 로케일도 영문이 아니라 자국어로 발화·전사된다(BCP-47 로케일 그대로 전달).
 */
export function buildDeepgramParams(locale: SttLocale): URLSearchParams {
  return new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
    diarize: "false",
    language: locale,
  });
}

export function parseDeepgramTranscript(
  raw: unknown,
  fallbackLocale: string,
): Transcript | null {
  const channel = (
    raw as {
      results?: {
        channels?: {
          detected_language?: string;
          alternatives?: { transcript?: string; confidence?: number }[];
        }[];
      };
    }
  )?.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const text = alt?.transcript?.trim();
  if (!text) return null;
  return {
    text,
    language_code: channel?.detected_language || fallbackLocale,
    confidence: typeof alt?.confidence === "number" ? alt.confidence : 0,
  };
}
