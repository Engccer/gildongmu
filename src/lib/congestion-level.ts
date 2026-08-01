/**
 * 혼잡도 등급어 번역 키 매핑 (순수, React/Next 비의존 — iOS Kit가 미러).
 *
 * `citydata_ppltn`은 **한국어만** 준다. 등급어는 닫힌 집합(4단계)이라 앱에서
 * 번역할 수 있지만, `AREA_CONGEST_MSG` 완성 문장은 자유 텍스트라 번역 수단이
 * 없다 — 비한국어 로케일에서는 등급어만 보이고 문장은 감춘다(§데이터 언어 분리).
 *
 * provider는 등급어를 **원문 그대로** 통과시키고(서울시가 단계를 늘려도 조용히
 * 빈 값이 되지 않게), 번역은 이 표시 계층에서만 한다. 표에 없는 값은 null을
 * 돌려주므로 소비자가 원문을 그대로 낭독하면 된다(정보 소실 없음).
 */
export type CongestionLevelKey = "relaxed" | "normal" | "slightlyBusy" | "busy";

const LEVELS: Record<string, CongestionLevelKey> = {
  여유: "relaxed",
  보통: "normal",
  "약간 붐빔": "slightlyBusy",
  붐빔: "busy",
};

/** 등급어 원문 → i18n 키. 미등재 값은 null(원문 낭독으로 폴백). */
export function congestionLevelKey(raw: string): CongestionLevelKey | null {
  return LEVELS[raw.trim()] ?? null;
}
