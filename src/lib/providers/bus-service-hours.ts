import { env } from "../env";
import { parseServiceTime } from "../service-hours";

/**
 * 버스 노선 운행 시간(첫차·막차) 조회.
 *
 * 서울은 ODsay lane[0].busLocalBlID가 TOPIS busRouteId와 동일 값이라
 * ID 직결 조인이 성립한다(342=124000038 실측 확정 2026-08-01).
 * 이름 매칭이 아니므로 동명 노선 함정이 없다.
 *
 * ⚠ 이 모듈은 절대 throw하지 않는다. 운행시간은 부가 정보이고,
 *   조회 실패가 길찾기 응답 자체를 죽이면 결함을 고치려다 더 큰 회귀를 만든다.
 *   실패한 노선은 Map에서 빠지고 호출부가 unknown으로 처리한다.
 */

const SEOUL_BASE = "http://ws.bus.go.kr/api/rest";

export interface ServiceHours {
  firstMinutes: number | null;
  lastMinutes: number | null;
}

interface SeoulRouteItem {
  firstBusTm?: string;
  lastBusTm?: string;
}

/** TOPIS getRouteInfo 응답 → ServiceHours. 결과 없으면 null. */
export function parseSeoulRouteInfo(raw: unknown): ServiceHours | null {
  if (!raw || typeof raw !== "object") return null;
  const body = (raw as { msgBody?: { itemList?: unknown } }).msgBody;
  const list = body?.itemList;
  if (!Array.isArray(list) || list.length === 0) return null;
  const item = list[0] as SeoulRouteItem;
  return {
    firstMinutes: parseServiceTime(item.firstBusTm),
    lastMinutes: parseServiceTime(item.lastBusTm),
  };
}

async function fetchSeoulRouteHours(routeId: string): Promise<ServiceHours | null> {
  const url = new URL(`${SEOUL_BASE}/busRouteInfo/getRouteInfo`);
  url.searchParams.set("serviceKey", env.DATA_GO_KR_API_KEY!);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("busRouteId", routeId);
  // 운행 시간은 준정적이라 하루 캐시. GET이라 revalidate가 실효한다.
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return parseSeoulRouteInfo(data);
}

/**
 * 노선 ID들의 운행 시간을 병렬 조회. 실패·미조회 노선은 Map에서 빠진다
 * (호출부가 부재를 unknown으로 읽는다). 키 없으면 빈 Map(게이트 패턴).
 */
export async function fetchServiceHoursMap(
  routeIds: string[],
): Promise<Map<string, ServiceHours>> {
  const map = new Map<string, ServiceHours>();
  if (!env.DATA_GO_KR_API_KEY || routeIds.length === 0) return map;
  const unique = [...new Set(routeIds.filter(Boolean))];
  const settled = await Promise.allSettled(
    unique.map(async (id) => ({ id, hours: await fetchSeoulRouteHours(id) })),
  );
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.hours) map.set(r.value.id, r.value.hours);
  }
  return map;
}
