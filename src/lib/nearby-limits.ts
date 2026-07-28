/** 내 주변 장소 목록 V2 3종(둘러보기·아이 놀 곳·무장애)의 옵트인 limit 상한.
    라우트는 검증 상한(MAX)으로, "더 보기" 구현 클라이언트(웹·iOS)는 요청값으로 같은 값을 쓴다.
    ⚠ iOS 미러: GildongmuKit NearbyService·BarrierFreeService의 fetchLimit(50) — 값 변경 시 동조. */
export const NEARBY_LIMIT_MAX = 50;
