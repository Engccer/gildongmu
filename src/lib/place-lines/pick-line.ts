import { prefersEnglish } from "../data-locale";

/**
 * 한 줄(한 접근성 객체)의 언어 선택(E27 §3.6, 설계 리뷰 #2·#3, a11y 감사 #1·#4).
 *
 * 한 줄 안에서 언어를 섞지 않는다 — 영문 조각(`*En`)이 **전부** 있을 때만 영어 줄이고, 하나라도 없으면
 * 줄 전체를 한국어 원문으로 둔다. 조각의 세 상태를 가른다:
 * - `undefined`/`null` = **결측**(ko엔 있는데 영문이 없다) → 한국어 폴백
 * - `""` = **자리 표시**(ko에도 그 조각이 없어 영문이 필요 없다 — 노선 미매핑·현재역 부재) → 영어 줄 가능
 * - 비어 있지 않은 문자열 = 영문 조각
 * Kit `TransitDisplay.pickLine`과 같은 의미(nil=결측·""=자리 표시).
 *
 * `lang`은 마크업 태그(웹 `lang` 속성)용이다: **한국어 폴백 줄은 언제나 `"ko"`**(UI 라벨이 섞여도 — 값이
 * 한국어인 줄은 통째로 ko, A26 선례), 영어 줄은 순수 데이터일 때(`pure`)만 UI 로케일이 en 계열이 아니면
 * `"en"`(ja 화면에서 `Gangnam`을 일본어 음성으로 읽지 않게). UI 문장 틀이 섞인 영어 줄은 태그하지 않는다
 * (분절 없이 못 달고, 분절은 헌장 위반 — E28 재료).
 */
export interface LocalizedLine {
  text: string;
  lang?: "ko" | "en";
}

export function pickLine(
  locale: string,
  ko: string,
  enParts: ReadonlyArray<string | undefined | null>,
  build: (parts: string[]) => string,
  opts: { pure?: boolean } = {},
): LocalizedLine {
  const pure = opts.pure ?? true;
  if (!prefersEnglish(locale)) return { text: ko };
  const complete = enParts.every((p): p is string => typeof p === "string");
  if (!complete) return { text: ko, lang: "ko" };
  const text = build(enParts as string[]);
  const tagEn = pure && !locale.toLowerCase().startsWith("en");
  return { text, ...(tagEn ? { lang: "en" as const } : {}) };
}

/** 이름 하나(역·정류소)의 표시 — 영문이 있으면 영문, 없으면 한국어(순수 데이터 한 조각). */
export function pickName(locale: string, ko: string, en: string | undefined | null): LocalizedLine {
  return pickLine(locale, ko, [en], ([e]) => e);
}
