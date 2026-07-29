/** 서버 커버리지 마커(spec §2) 감지 — 200 응답 body 전용, React 비의존. */
export function isOutOfCoverageBody(body: unknown): body is { outOfCoverage: true } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { outOfCoverage?: unknown }).outOfCoverage === true
  );
}
