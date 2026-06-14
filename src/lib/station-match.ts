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

/** 역 이름 정규화 — 접미사(역/station) 제거, 소문자/trim(매칭 키). */
export function normalizeStationName(name: string): string {
  return name
    .trim()
    .replace(/\s*station$/i, "")
    .replace(/역$/, "")
    .trim()
    .toLowerCase();
}
