import type { Place } from "./types";

/**
 * 주소 → 시·도(광역지자체) 분류.
 *
 * 카테고리 버킷(category.ts)이 "성격"으로 결과를 가르는 것과 달리, 지역 필터는
 * "위치"로 가른다. 동일 브랜드·체인 검색("테라로사")은 카테고리가 한 버킷으로
 * 수렴해 카테고리 칩이 무의미해지므로, 전국에 흩어진 결과를 시·도로 분류한다.
 *
 * 한국 주소는 항상 시·도로 시작하므로 첫 토큰만 보면 충분하다. 부분 문자열
 * 매칭(includes)은 "경기 광주시"를 광주광역시로 오인하므로 첫 토큰 exact
 * 매칭을 쓴다. 매칭 실패(해외·비정형 주소)는 null로 떨어져 어느 지역 칩에도
 * 잡히지 않는다(category의 "other"와 달리 "미상" 버킷을 두지 않는다 — 위치
 * 미상 장소를 한 칩에 모아도 탐색에 도움이 안 되기 때문).
 */

export type RegionCode =
  | "seoul"
  | "busan"
  | "daegu"
  | "incheon"
  | "gwangju"
  | "daejeon"
  | "ulsan"
  | "sejong"
  | "gyeonggi"
  | "gangwon"
  | "chungbuk"
  | "chungnam"
  | "jeonbuk"
  | "jeonnam"
  | "gyeongbuk"
  | "gyeongnam"
  | "jeju";

/** 표시·정렬 순서 — 행정 표준 시·도 순(서울→…→제주). */
const REGION_ORDER: RegionCode[] = [
  "seoul",
  "busan",
  "daegu",
  "incheon",
  "gwangju",
  "daejeon",
  "ulsan",
  "sejong",
  "gyeonggi",
  "gangwon",
  "chungbuk",
  "chungnam",
  "jeonbuk",
  "jeonnam",
  "gyeongbuk",
  "gyeongnam",
  "jeju",
];

/**
 * 주소 첫 토큰의 모든 표기 변형을 slug로. 약칭(카카오 address_name)과
 * 풀네임(특별·광역시/도, 특별자치도)을 모두 키로 둔다.
 */
const REGION_ALIASES: Record<string, RegionCode> = {
  서울: "seoul",
  서울특별시: "seoul",
  부산: "busan",
  부산광역시: "busan",
  대구: "daegu",
  대구광역시: "daegu",
  인천: "incheon",
  인천광역시: "incheon",
  광주: "gwangju",
  광주광역시: "gwangju",
  대전: "daejeon",
  대전광역시: "daejeon",
  울산: "ulsan",
  울산광역시: "ulsan",
  세종: "sejong",
  세종시: "sejong",
  세종특별자치시: "sejong",
  경기: "gyeonggi",
  경기도: "gyeonggi",
  강원: "gangwon",
  강원도: "gangwon",
  강원특별자치도: "gangwon",
  충북: "chungbuk",
  충청북도: "chungbuk",
  충남: "chungnam",
  충청남도: "chungnam",
  전북: "jeonbuk",
  전라북도: "jeonbuk",
  전북특별자치도: "jeonbuk",
  전남: "jeonnam",
  전라남도: "jeonnam",
  경북: "gyeongbuk",
  경상북도: "gyeongbuk",
  경남: "gyeongnam",
  경상남도: "gyeongnam",
  제주: "jeju",
  제주도: "jeju",
  제주특별자치도: "jeju",
};

/**
 * 장소의 시·도 slug. 지번 주소(address) 우선, 비면 도로명(roadAddress)으로
 * 폴백. 첫 토큰이 알려진 시·도가 아니면 null.
 */
export function regionOf(place: Place): RegionCode | null {
  const source = place.address.trim() || place.roadAddress.trim();
  const firstToken = source.split(/\s+/)[0];
  if (!firstToken) return null;
  return REGION_ALIASES[firstToken] ?? null;
}

/** 결과에 실제 존재하는 시·도만 REGION_ORDER 순서로(중복 제거, null 제외). */
export function regionsPresent(places: Place[]): RegionCode[] {
  const present = new Set<RegionCode>();
  for (const p of places) {
    const r = regionOf(p);
    if (r) present.add(r);
  }
  return REGION_ORDER.filter((r) => present.has(r));
}

/** 선택 시·도로 필터. null이면 전체(입력 순서 보존). */
export function filterPlacesByRegion(
  places: Place[],
  region: RegionCode | null,
): Place[] {
  if (region === null) return places;
  return places.filter((p) => regionOf(p) === region);
}
