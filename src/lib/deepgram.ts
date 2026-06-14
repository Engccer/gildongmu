/**
 * Deepgram STT 응답을 앱 공통 형태로 정규화한다(React/Next 비의존).
 * 전사 텍스트가 비면 null(인식 실패) — 가짜 결과를 만들지 않는다.
 */
export interface Transcript {
  text: string;
  language_code: string;
  confidence: number;
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
