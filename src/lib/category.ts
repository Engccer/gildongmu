import type { Place } from "./types";

/**
 * 의미 기반 카테고리 재분류.
 *
 * 카카오 로컬은 계층형 한글 문자열("여행 > 관광,명소 > 문화유적 > 고궁,궁"),
 * TourAPI는 라벨("Tourist Attraction"·"관광지")로 카테고리를 준다. 두 체계를
 * 공통 버킷으로 묶어 en/ko 검색 결과를 성격별 섹션으로 표시한다(B안, 정보
 * 최대 제공 — 출처를 섞되 카테고리로 재편). 키워드 포함 매칭이라 미지의
 * 카테고리는 조용히 "other"로 떨어진다.
 */

export type CategoryBucket =
  | "attraction"
  | "food"
  | "shopping"
  | "lodging"
  | "transport"
  | "other";

export interface CategoryGroup {
  bucket: CategoryBucket;
  places: Place[];
}

/** 표시·매칭 순서. 검색 의도(관광·명소)를 위에, 부수 정보(교통)를 아래에. */
const BUCKET_ORDER: CategoryBucket[] = [
  "attraction",
  "food",
  "shopping",
  "lodging",
  "transport",
  "other",
];

/**
 * 버킷별 키워드. 위에서부터 검사해 첫 매칭 버킷을 반환하므로, 순서는
 * BUCKET_ORDER와 같다(관광이 교통보다 우선). 한글(카카오)·영문(TourAPI)
 * 키워드를 한 정규식에 담는다.
 */
const BUCKET_RULES: [CategoryBucket, RegExp][] = [
  ["attraction", /관광|명소|문화|유적|고궁|궁궐|사찰|박물|미술|공원|축제|공연|행사|레포츠|Attraction|Cultural|Festival|Leisure|Tour/i],
  ["food", /음식|맛집|카페|제과|베이커리|Restaurant|Cafe|Food/i],
  ["shopping", /쇼핑|마트|백화점|시장|면세|아울렛|편의점|Shopping|Market/i],
  ["lodging", /숙박|호텔|모텔|펜션|게스트|리조트|Accommodation|Hotel|Lodging/i],
  ["transport", /교통|지하철|전철|철도|기차|버스|주차|공항|터미널|Transport|Station|Parking|Airport/i],
];

/** 카테고리 문자열을 공통 버킷으로 매핑. 미매칭은 "other". */
export function categoryOf(category: string): CategoryBucket {
  for (const [bucket, re] of BUCKET_RULES) {
    if (re.test(category)) return bucket;
  }
  return "other";
}

/**
 * 장소들을 버킷별로 묶는다. BUCKET_ORDER 순서를 따르고, 빈 버킷은 생략하며,
 * 같은 버킷 안에서는 입력 순서를 보존한다.
 */
export function groupByCategory(places: Place[]): CategoryGroup[] {
  const map = new Map<CategoryBucket, Place[]>();
  for (const p of places) {
    const bucket = categoryOf(p.category);
    const list = map.get(bucket);
    if (list) list.push(p);
    else map.set(bucket, [p]);
  }
  return BUCKET_ORDER.filter((b) => map.has(b)).map((bucket) => ({
    bucket,
    places: map.get(bucket)!,
  }));
}

/** 결과 안에 실제로 존재하는 버킷만 BUCKET_ORDER 순서로 반환(칩 표시용). */
export function bucketsPresent(places: Place[]): CategoryBucket[] {
  const present = new Set(places.map((p) => categoryOf(p.category)));
  return BUCKET_ORDER.filter((b) => present.has(b));
}

/** 선택 버킷으로 필터. null이면 전체 반환(입력 순서 보존). */
export function filterPlacesByBucket(
  places: Place[],
  bucket: CategoryBucket | null,
): Place[] {
  if (bucket === null) return places;
  return places.filter((p) => categoryOf(p.category) === bucket);
}
