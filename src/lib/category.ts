import type { Place } from "./types";

/**
 * 의미 기반 카테고리 재분류 — 칩 필터 전용.
 *
 * 카카오 로컬은 계층형 한글 문자열("여행 > 관광,명소 > 문화유적 > 고궁,궁"),
 * TourAPI는 라벨("Tourist Attraction"·"관광지")로 카테고리를 준다. 두 체계를
 * 공통 버킷으로 묶어 칩 필터 축으로만 쓴다. 키워드 포함 매칭이라 미지의
 * 카테고리는 조용히 "other"로 떨어진다 — 버킷은 순위를 결정하지 않으므로
 * (결과는 항상 정확도순 플랫 리스트) "other"는 실패가 아니라 솔직한 잔여
 * 라벨이다(2026-07-21 섹션 그룹핑 폐지, 정확도 1위 매몰 6사례 실측).
 */

export type CategoryBucket =
  | "attraction"
  | "public"
  | "food"
  | "shopping"
  | "lodging"
  | "transport"
  | "other";

/** 칩 표시·매칭 순서. 정렬은 정확도(관련도)가 전담하고 버킷은 필터 축일 뿐이다. */
const BUCKET_ORDER: CategoryBucket[] = [
  "attraction",
  "public",
  "food",
  "shopping",
  "lodging",
  "transport",
  "other",
];

/**
 * 버킷별 키워드. 위에서부터 검사해 첫 매칭 버킷을 반환하므로, 순서는
 * BUCKET_ORDER와 같다. 한글(카카오·네이버)·영문(TourAPI) 키워드를 한 정규식에
 * 담는다. 부분 문자열 오탐 이력(수정 시 반드시 실측 카테고리로 검증):
 * '문화'→사진관, '미술'→가죽공예 공방, '카페'→키즈카페.
 */
const BUCKET_RULES: [CategoryBucket, RegExp][] = [
  // '문화시설'만 매칭('문화' 단독은 카카오 최상위 "문화,예술" 트리의 사진관·즉석사진
  // 등 비명소까지 attraction으로 끌어와 금지 — '문화유적'은 '유적'이 커버).
  // '미술관'만 매칭('미술' 단독은 "미술,공예" 공방 트리 오탐 — 미술관은 '문화시설'도 커버).
  ["attraction", /관광|명소|문화시설|유적|고궁|궁궐|사찰|박물|미술관|공원|축제|공연|행사|레포츠|Attraction|Cultural|Festival|Leisure|Tour/i],
  // '공공'이 카카오 "사회,공공기관"·네이버 "공공,사회기관" 트리 전체(행정·단체·복지)를 커버.
  ["public", /교육|학교|유치원|어린이집|공공|관공서|주민센터|도서관|우체국|복지|School|University|Library|Government|Public/i],
  // 키즈카페는 놀이시설(음식점 아님) — '카페' 앞 '키즈'를 부정 후방탐색으로 제외.
  ["food", /음식|맛집|(?<!키즈)카페|제과|베이커리|Restaurant|Cafe|Food/i],
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
