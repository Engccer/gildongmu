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
const TAGO_BASE = "http://apis.data.go.kr/1613000/BusRouteInfoInqireService";

/**
 * ODsay busCityCode → TAGO cityCode. 두 체계가 달라 매핑이 불가피하다.
 * 2026-08-01 실호출로 endsWith 매칭이 확인된 지역만 넣는다.
 * 없는 지역은 조회하지 않고 unknown으로 남는다(추측 금지).
 */
export const TAGO_CITY_CODE: Record<number, number> = {
  7000: 21, // 부산
  4000: 22, // 대구
  2000: 23, // 인천
};

export interface ServiceHours {
  firstMinutes: number | null;
  lastMinutes: number | null;
}

/** 운행시간 조회에 필요한 노선 식별자 묶음. */
export interface BusRouteRef {
  /** ODsay lane[0].busLocalBlID */
  localId: string;
  /** ODsay lane[0].busCityCode */
  cityCode: number;
  /** 노선 번호(ODsay busNo). TAGO는 번호 검색 후 대조가 필요하다 */
  routeNo: string;
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

interface TagoRouteItem {
  routeid?: unknown;
  startvehicletime?: string;
  endvehicletime?: string;
}

/**
 * TAGO 노선 검색 응답에서 localId에 해당하는 항목의 운행시간.
 *
 * ⚠ 지역마다 ODsay가 주는 blID 형식이 다르다(실측 2026-08-01):
 *   부산 5200141000 → routeid BSB5200141000(접두사 붙음)
 *   대구 DGB3000323101 → routeid 동일 값
 *   인천 165000313 → routeid ICB165000313
 * 접두사를 조립하면 대구에서 DGBDGB…가 되어 깨지므로 endsWith로 흡수한다.
 * 다만 짧은 ID의 숫자 꼬리 우연 일치를 막으려고 남는 접두사가 알파벳뿐인지도 본다.
 */
export function parseTagoRouteHours(raw: unknown, localId: string): ServiceHours | null {
  const item = (raw as { response?: { body?: { items?: { item?: unknown } } } })?.response?.body
    ?.items?.item;
  const list = Array.isArray(item) ? item : item ? [item] : [];
  const hit = (list as TagoRouteItem[]).find((x) => {
    if (typeof x.routeid !== "string" || !x.routeid.endsWith(localId)) return false;
    const prefix = x.routeid.slice(0, x.routeid.length - localId.length);
    return /^[A-Za-z]*$/.test(prefix);
  });
  if (!hit) return null;
  return {
    firstMinutes: parseServiceTime(hit.startvehicletime),
    lastMinutes: parseServiceTime(hit.endvehicletime),
  };
}

async function fetchTagoRouteHours(ref: BusRouteRef): Promise<ServiceHours | null> {
  const cityCode = TAGO_CITY_CODE[ref.cityCode];
  if (!cityCode || !ref.routeNo) return null;
  const url = new URL(`${TAGO_BASE}/getRouteNoList`);
  url.searchParams.set("serviceKey", env.DATA_GO_KR_API_KEY!);
  url.searchParams.set("_type", "json");
  url.searchParams.set("cityCode", String(cityCode));
  url.searchParams.set("routeNo", ref.routeNo);
  url.searchParams.set("numOfRows", "20");
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return parseTagoRouteHours(data, ref.localId);
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
 * 한 노선의 운행 시간. TOPIS를 먼저 시도하고 없을 때만 TAGO로 간다.
 *
 * ⚠ 분기 기준은 도시 코드가 아니라 "TOPIS가 답하는가"다. TOPIS는 서울 노선뿐
 *   아니라 수도권 광역 노선도 보유한다(하남 30-3은 busCityCode 1070인데
 *   TOPIS에서 "30-3하남" 04:15~23:40으로 조회된다 — 실측 2026-08-01).
 *   수도권 통합 환승 탓에 서울 출발 경로에 경기 노선이 흔히 섞이므로,
 *   도시 코드로 갈라내면 그 노선들이 전부 unknown으로 샌다.
 *   TOPIS는 ID 직결 1회 호출이고 결과는 하루 캐시라 선시도 비용이 낮다.
 */
async function fetchRouteHours(ref: BusRouteRef): Promise<ServiceHours | null> {
  const seoul = await fetchSeoulRouteHours(ref.localId);
  if (seoul) return seoul;
  return fetchTagoRouteHours(ref);
}

/**
 * 노선들의 운행 시간을 병렬 조회(TOPIS 우선, 미보유 노선만 TAGO).
 * 실패·미조회 노선은 Map에서 빠진다(호출부가 부재를 unknown으로 읽는다).
 * 키 없으면 빈 Map(게이트 패턴). Map 키는 localId.
 */
export async function fetchServiceHoursMap(
  refs: BusRouteRef[],
): Promise<Map<string, ServiceHours>> {
  const map = new Map<string, ServiceHours>();
  if (!env.DATA_GO_KR_API_KEY || refs.length === 0) return map;
  const unique = [...new Map(refs.filter((r) => r.localId).map((r) => [r.localId, r])).values()];
  const settled = await Promise.allSettled(
    unique.map(async (ref) => ({ id: ref.localId, hours: await fetchRouteHours(ref) })),
  );
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.hours) map.set(r.value.id, r.value.hours);
  }
  return map;
}
