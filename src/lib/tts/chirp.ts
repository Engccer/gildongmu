/**
 * Google Cloud TTS Chirp 3 HD 합성 (서버 전용, dodo-planet `src/lib/tts/chirp.ts` 이식).
 *
 * 비용: $30/1M자 + 월 1M자 무료 티어(dodo 실측 docs/evals/2026-06-12-tts-latency-research.md,
 * short 97자 기준 2.4초). 5개 로케일 모두 Puck 보이스 보유.
 *
 * DOMAIN RULE: Cloud TTS `text:synthesize`는 요청당 입력 5,000 bytes 한도
 * (글자 수 아님 — 한국어는 글자당 3 bytes). 초과 텍스트는 문장 경계에서
 * byte-aware 분할 후 병렬 합성하고 MP3 프레임을 그대로 이어 붙인다
 * (MP3 concat은 AVAudioPlayer·HTMLAudioElement 재생 호환 — WAV/FLAC는 헤더 중복으로 불가).
 */

export type ChirpLocale = "ko" | "en" | "es" | "fr" | "it";

const CHIRP_LANGUAGE_CODES: Record<ChirpLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  es: "es-ES",
  fr: "fr-FR",
  it: "it-IT",
};

/** 전 로케일 공통 보이스 — dodo와 같은 Puck 패밀리(음색 일관성) */
const CHIRP_VOICE_NAME = "Chirp3-HD-Puck";

/** API 한도 5,000 bytes에 대한 안전 마진 */
export const CHIRP_MAX_CHUNK_BYTES = 4500;

const CHIRP_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

const encoder = new TextEncoder();

export function getChirpVoice(locale: ChirpLocale): {
  languageCode: string;
  name: string;
} {
  const languageCode = CHIRP_LANGUAGE_CODES[locale];
  return { languageCode, name: `${languageCode}-${CHIRP_VOICE_NAME}` };
}

/**
 * 입력을 byte 한도 이하 청크로 분할. 문장 경계 우선, 한도를 넘는
 * 단일 문장만 글자 단위로 강제 분할한다.
 */
export function splitTextForChirp(
  text: string,
  maxBytes: number = CHIRP_MAX_CHUNK_BYTES
): string[] {
  if (encoder.encode(text).length <= maxBytes) {
    return text.trim() ? [text] : [];
  }

  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current);
    current = "";
  };

  for (const sentence of sentences) {
    if (encoder.encode(current + sentence).length <= maxBytes) {
      current += sentence;
      continue;
    }
    pushCurrent();
    if (encoder.encode(sentence).length <= maxBytes) {
      current = sentence;
      continue;
    }
    // 한도 초과 단일 문장 — 글자 단위 강제 분할
    for (const ch of sentence) {
      if (encoder.encode(current + ch).length > maxBytes) pushCurrent();
      current += ch;
    }
  }
  pushCurrent();
  return chunks;
}

/**
 * 텍스트를 Chirp 3 HD로 합성해 MP3 바이트를 반환.
 * 실패(키 미설정·HTTP 에러·빈 응답)는 throw — 호출자(/api/tts)가
 * fallback shape(502)로 변환해 클라이언트 온디바이스 낭독 폴백을 트리거한다.
 */
export async function synthesizeChirpMp3(
  text: string,
  locale: ChirpLocale
): Promise<Uint8Array> {
  const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_CLOUD_TTS_API_KEY is not set");

  const voice = getChirpVoice(locale);
  const chunks = splitTextForChirp(text);
  if (chunks.length === 0) throw new Error("Chirp TTS: empty input text");

  const parts = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`${CHIRP_ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: chunk },
          voice,
          audioConfig: { audioEncoding: "MP3" },
        }),
      });
      if (!res.ok) {
        // 주의: 에러 메시지에 요청 URL(API key 포함)을 넣지 않는다
        throw new Error(`Chirp TTS HTTP ${res.status}`);
      }
      const body = (await res.json()) as { audioContent?: string };
      if (!body.audioContent) throw new Error("Chirp TTS: empty audioContent");
      return Buffer.from(body.audioContent, "base64");
    })
  );

  return Buffer.concat(parts);
}
