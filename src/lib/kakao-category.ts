import dictionary from "./data/kakao-category-en.json";
import { prefersEnglish } from "./data-locale";

/**
 * 카카오 `category_name` 영문화(A28) — spec `docs/superpowers/specs/2026-08-31-kakao-category-en-design.md`.
 *
 * 카카오 로컬 분류는 `" > "`로 이어진 경로(`"교육,학문 > 학교 > 중학교"`)이고 세그먼트는 카카오맵
 * 분류 트리의 노드 라벨이라 유한 집합이다 — 단 공개 목록이 없어 사전(`data/kakao-category-en.json`)은
 * 실호출 스윕의 **스냅샷**이다(`scripts/build-kakao-category-en.mjs`, 게이트 `verify-kakao-category-en.mjs`).
 *
 * 계약: 세그먼트 **전부** 등재일 때만 영문 경로, 하나라도 미등재면 `null`(부분 번역 혼합 금지 —
 * "Education & Academia > 학교 > Middle School"은 어느 언어 엔진으로도 읽을 수 없다). 소비자는 `null`이면
 * 한국어 원문 + `lang="ko"`(A26·E28 판정 그대로). 세그먼트 안의 쉼표(`"교육,학문"`)는 병렬이지 구분자가
 * 아니라 키 그대로다. 판정 축(`isStation`·검색 칩 버킷·키즈 화이트리스트·채팅 컨텍스트)은 원문 `category`를
 * 계속 읽는다 — `categoryEn`은 표시 전용이다.
 */
const SEGMENT_EN: Record<string, string> = dictionary;

/**
 * 경로 → 세그먼트(NFC·trim). `>` 주변 공백은 관용이지만 **빈 세그먼트가 하나라도 있으면 빈 배열**(fail-closed,
 * 설계 리뷰 #13) — `"a >  > b"`를 조각을 버려 `"a > b"`로 승인하면 원래 승인하지 않은 경로가 번역된다.
 * 제어 문자가 섞인 경로도 승인하지 않는다.
 */
export function splitKakaoCategory(path: string): string[] {
  const nfc = path.normalize("NFC");
  if (nfc.trim() === "") return [];
  if (/[\u0000-\u001F\u007F]/.test(nfc)) return [];
  const segments = nfc.split(">").map((s) => s.trim());
  return segments.some((s) => s === "") ? [] : segments;
}

/** 전부 등재 → `"A > B > C"`, 아니면 `null`. 빈 경로도 `null`. */
export function kakaoCategoryEn(path: string): string | null {
  const segments = splitKakaoCategory(path);
  if (segments.length === 0) return null;
  const en: string[] = [];
  for (const seg of segments) {
    const label = SEGMENT_EN[seg];
    if (!label) return null;
    en.push(label);
  }
  return en.join(" > ");
}

/** provider 투영용 — `categoryEn`이 있을 때만 키를 싣는다(부재 = 키 부재, `undefined` 키 금지). */
export function categoryEnField(path: string): { categoryEn?: string } {
  const en = kakaoCategoryEn(path);
  return en ? { categoryEn: en } : {};
}

/**
 * 표시 계층이 부르는 유일한 자리 ↔ Kit `pickCategory(lang:category:categoryEn:)`, 공유 fixture
 * `__tests__/fixtures/kakao-category-pick-cases.json`. 비-ko(데이터 로케일 en)는 `categoryEn` 우선,
 * 부재·빈 문자열이면 원문. ko는 항상 원문(byte-identical).
 */
export function pickCategory(
  locale: string,
  place: { category: string; categoryEn?: string | null },
): string {
  if (!prefersEnglish(locale)) return place.category;
  return place.categoryEn || place.category;
}

/** 사전 크기(테스트·게이트 보고용). */
export const KAKAO_CATEGORY_SEGMENT_COUNT = Object.keys(SEGMENT_EN).length;
