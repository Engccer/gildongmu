/**
 * ODsay error 봉투 판독.
 *
 * ⚠ 봉투가 두 모양이다(2026-08-07 실호출 확정):
 *   객체: {code:"-98", msg:"출, 도착지가 700m이내입니다."}   경로 없음
 *   배열: [{code:"500", message:"[ApiKeyAuthFailed] ..."}]  인증 실패
 * 키 이름도 msg/message로 갈린다. 배열을 객체로 읽으면 code가 undefined가 되어
 * 코드 판정이 통째로 무력화되고, 배열 모양으로 경로 없음류가 오는 순간
 * 그것이 502 장애로 둔갑한다. 두 모양을 다 받는 것이 이 모듈의 존재 이유다.
 *
 * ⚠ 무효 키는 HTTP 200으로 온다. 상태 코드로 인증 실패를 가를 수 없다.
 */

/** "경로 없음"으로 graceful 처리할 코드. 관측된 것만 넣는다(추측 금지). */
const NO_ROUTE_CODES = new Set(["-98"]);

export function isNoRouteError(code: string): boolean {
  return NO_ROUTE_CODES.has(code);
}

export function readOdsayError(raw: unknown): { code: string; message: string } | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== "object") return null;
  const rec = first as { code?: unknown; msg?: unknown; message?: unknown };
  const code = rec.code == null ? "" : String(rec.code);
  const message = String(rec.msg ?? rec.message ?? "");
  return { code, message };
}
