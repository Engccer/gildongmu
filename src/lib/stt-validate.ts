/**
 * STT 라우트 입력 검증(순수, React/Next 비의존) — 서버 경계 직접 호출 방어.
 *
 * 검증 항목:
 * - 오디오 Blob 존재·비어있지 않음(size>0)·최대 크기 이내.
 * - MIME allowlist: 빈 type은 허용(일부 브라우저가 빈 type으로 녹음),
 *   값이 있으면 `audio/`로 시작해야 함(비-audio 명시 type 거부).
 * - locale: 앱 지원 언어(ko/en/es/fr/it/ja)만 허용, 그 외는 `ko`로 폴백.
 *   Deepgram nova-3가 여섯 언어를 모두 인식하므로(ja는 2026-07-28 실호출 확인)
 *   데이터 매핑(dataLocale) 없이 실제 로케일을 그대로 STT 언어로 쓴다.
 */

// 서버 상한은 웹 UI 60초 녹음 캡 기준(opus 60초 ≈ 1MB 미만)의 여유분.
// 25MB(약 100분 오디오)는 유료 Deepgram 직접 호출 어뷰징 표면이었다.
export const STT_MAX_SIZE = 5 * 1024 * 1024; // 5MB
const SUPPORTED_LOCALES = ["ko", "en", "es", "fr", "it", "ja"] as const;

export type SttLocale = (typeof SUPPORTED_LOCALES)[number];

export type SttValidation =
  | { ok: true; locale: SttLocale }
  | { ok: false; reason: "missing" | "empty" | "too_large" | "bad_type" };

/** 임의 locale 입력을 지원 로케일로 정규화(미지원·null은 ko 폴백). */
export function normalizeSttLocale(raw: unknown): SttLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(raw as string)
    ? (raw as SttLocale)
    : "ko";
}

/**
 * 오디오 입력 검증. Blob의 size/type만 보므로 서버·테스트 양쪽에서 호출 가능.
 */
export function validateSttInput(
  audio: unknown,
  rawLocale: unknown,
): SttValidation {
  if (!(audio instanceof Blob)) return { ok: false, reason: "missing" };
  if (audio.size === 0) return { ok: false, reason: "empty" };
  if (audio.size > STT_MAX_SIZE) return { ok: false, reason: "too_large" };
  // 빈 type은 허용(브라우저 차이), 값이 있으면 audio/* 만 허용.
  if (audio.type && !audio.type.startsWith("audio/")) {
    return { ok: false, reason: "bad_type" };
  }
  return { ok: true, locale: normalizeSttLocale(rawLocale) };
}
