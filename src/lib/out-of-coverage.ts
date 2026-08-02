/** 서버 커버리지 마커(spec §2) 감지 — 200 응답 body 전용, React 비의존. */
export function isOutOfCoverageBody(body: unknown): body is { outOfCoverage: true } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { outOfCoverage?: unknown }).outOfCoverage === true
  );
}

/**
 * 서비스 지역 미제공 사유 — 한국 **안**이지만 그 도메인의 데이터가 그 지역에 없을 때.
 * `outOfCoverage`(한국 밖, 앱 전체가 무용)와 층이 다르다: 이쪽은 그 메뉴 하나만
 * 무용하고 나머지 기능은 정상이므로, 안내 문구도 "이 서비스는 ~ 지역만"이 된다.
 */
export type UnavailableHereReason = "seoulOnly";

/**
 * 서비스 지역 미제공 마커 감지 — 200 응답 body 전용, React 비의존.
 *
 * ⚠ 이것을 "0건"이나 "조회 실패"로 흡수하지 말 것(3-state 불변식). 부산에서 따릉이
 * 0건을 들은 사용자는 반경을 넓히거나 나중에 다시 볼 여지를 상상하지만, 실제로는
 * 300km 밖이라 영원히 결과가 없다.
 */
export function unavailableHereReason(body: unknown): UnavailableHereReason | null {
  if (typeof body !== "object" || body === null) return null;
  const reason = (body as { unavailableHere?: unknown }).unavailableHere;
  return reason === "seoulOnly" ? reason : null;
}
