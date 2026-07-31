import type { Place } from "./types";

/**
 * 장소가 철도/지하철 역인지 판정하고, 역 이름을 매칭 키로 정규화한다.
 *
 * 순수 함수만 모은 모듈 — React/Next 비의존이라 dodo-planet 이식에도
 * 그대로 가져갈 수 있다. 역 판정은 (1) 카테고리에 교통 키워드가 있거나
 * (2) 이름이 "역"/"station"으로 끝나면 역으로 본다.
 */

// "Station"은 카테고리에서 제외한다 — "Stationery"(문구) 등을 역으로 오판하기
// 때문. 영문 역 판정은 이름 접미사(/station$/i)에만 맡긴다.
const STATION_CATEGORY = /지하철|전철|철도|기차|Subway|Metro|Railway|Train/i;

/** 장소가 철도/지하철 역인지 — 카테고리 또는 이름 접미사로 판정. */
export function isStation(place: Place): boolean {
  if (STATION_CATEGORY.test(place.category)) return true;
  const n = place.name.trim();
  return /역$/.test(n) || /station$/i.test(n);
}

// 후행 노선 토큰: 공백 뒤 "…선"("5호선"·"신분당선") 또는 "…철도"("공항철도"),
// "GTX-…" 형태. 역명 자체는 무공백이 관례라 공백 분리 후행 토큰만 건드린다.
const TRAILING_LINE_TOKEN = /(?:\s+(?:\S*(?:선|철도)|GTX-\S*))+$/i;

/**
 * 역명 장식 제거(대소문자 보존): 괄호 부가명·후행 노선 토큰·"역"/"station" 접미.
 * API contains-필터 질의(wksn stnNm·swopenapi)와 매칭 키의 공통 전처리.
 */
export function stripStationDecorations(name: string): string {
  return name
    .replace(/\s*\([^)]*\)/g, "")
    .replace(TRAILING_LINE_TOKEN, "")
    .trim()
    .replace(/\s*station$/i, "")
    .replace(/역$/, "")
    .trim();
}

/** 역 이름 정규화(매칭 키 전용): 장식 제거 + 소문자. 표시명에는 쓰지 않는다. */
export function normalizeStationName(name: string): string {
  return stripStationDecorations(name).toLowerCase();
}

/**
 * 역 질의 분해: 매칭 키와 노선 힌트("양평역 5호선"의 "5호선"은 경의중앙선
 * 양평역(동명이역)과의 유일한 구분자라 버리면 안 된다).
 */
export function parseStationQuery(name: string): { nameKey: string; lineHint?: string } {
  const noParen = name.replace(/\s*\([^)]*\)/g, "").trim();
  const m = noParen.match(TRAILING_LINE_TOKEN);
  const nameKey = normalizeStationName(name);
  if (!m) return { nameKey };
  const lineHint = m[0].trim();
  return lineHint ? { nameKey, lineHint } : { nameKey };
}

/**
 * 노선명 ↔ 힌트 매칭: "선"/"철도" 접미를 벗긴 코어의 상호 접두 일치(TAGO 축약형 흡수).
 *
 * 코어에서 구분자(가운뎃점·마침표·공백)도 지운다 — 같은 노선을 소스마다 다르게
 * 끊어 쓴다(ODsay "수도권 수인.분당선" ↔ TAGO "수인분당", 실측 2026-08-01).
 * 구분자는 표기 습관이지 노선 구분 정보가 아니라 지워도 다른 노선과 섞이지 않는다.
 */
export function lineHintMatches(lineName: string, lineHint: string): boolean {
  const core = (s: string) =>
    s.trim().toLowerCase().replace(/(철도|호선|선)$/g, "").replace(/[.·\s]/g, "");
  const a = core(lineName);
  const b = core(lineHint);
  if (!a || !b) return false;
  // 코어가 숫자만 남으면("1"·"11") 접두 포함을 완전 일치로 제한한다.
  // "11".startsWith("1")이 true라 "1호선"과 "11호선"이 오매칭되는 것을 방지.
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return a === b;
  return a === b || a.startsWith(b) || b.startsWith(a);
}
