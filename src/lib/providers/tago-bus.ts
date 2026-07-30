import type { BusArrival, BusRouteStop, BusStop } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 국토교통부 TAGO(국가대중교통정보센터) 시내버스 provider.
 *
 * 3종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유):
 * - A-2 BusSttnInfoInqireService/getCrdntPrxmtSttnList — 좌표 근접 정류소
 * - A-1 ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList — 정류소별 도착예정
 * - A-3 BusRouteInfoInqireService/getRouteAcctoThrghSttnList — 노선 경유정류소
 *
 * data.go.kr 표준 envelope(response.body.items.item, 빈결과 items:"")를
 * 코레일 편의시설과 동일하게 가정한다. 거리 정렬은 Haversine로 직접 계산한다
 * (A-2가 거리순을 보장하지 않으므로 — 산술은 코드의 책임).
 */

type RawItem = Record<string, unknown>;

/** data.go.kr 표준 envelope에서 item 배열을 안전 추출(코레일과 동일 규약). */
export function parseTagoItems(raw: unknown): RawItem[] {
  const items = (raw as { response?: { body?: { items?: unknown } } })?.response
    ?.body?.items;
  if (!items || items === "") return [];
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item as RawItem[];
  if (item && typeof item === "object") return [item as RawItem];
  return [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** 유한 실수 또는 NaN(파싱 불가 표식). */
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 음수·비유한 방어 후 반올림 정수(0 이상). */
function nonNegInt(v: unknown): number {
  const n = numF(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** A-2 응답 → 거리 오름차순 BusStop[](도착정보는 빈 배열로 시작). */
export function parseBusStops(
  raw: unknown,
  originLat: number,
  originLng: number,
): BusStop[] {
  return parseTagoItems(raw)
    .map((it): BusStop => {
      const lat = numF(it.gpslati);
      const lng = numF(it.gpslong);
      return {
        nodeId: str(it.nodeid),
        cityCode: str(it.citycode),
        name: str(it.nodenm),
        stopNo: it.nodeno != null && str(it.nodeno) !== "" ? str(it.nodeno) : undefined,
        lat,
        lng,
        distanceMeters: Math.round(haversineMeters(originLat, originLng, lat, lng)),
        source: "tago" as const,
        arrivalStatus: "ok", // 기본값 — fetchTagoNearby가 A-1 결과로 ok/unavailable 확정
        arrivals: [],
      };
    })
    .filter((s) => s.nodeId && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** A-1 응답 → 도착 임박 순 BusArrival[]. */
export function parseBusArrivals(raw: unknown): BusArrival[] {
  return parseTagoItems(raw)
    .map((it): BusArrival => ({
      routeId: str(it.routeid),
      routeNo: str(it.routeno),
      routeType: str(it.routetp),
      arrivalSeconds: nonNegInt(it.arrtime),
      prevStationCount: nonNegInt(it.arrprevstationcnt),
      lowFloor: str(it.vehicletp).includes("저상"),
      source: "tago" as const,
    }))
    .filter((a) => a.routeNo)
    .sort((a, b) => a.arrivalSeconds - b.arrivalSeconds);
}

/** A-3 응답 → 순번 오름차순 BusRouteStop[]. */
export function parseBusRouteStops(raw: unknown): BusRouteStop[] {
  return parseTagoItems(raw)
    .map((it): BusRouteStop => ({
      nodeId: str(it.nodeid),
      name: str(it.nodenm),
      order: nonNegInt(it.nodeord),
      lat: numF(it.gpslati),
      lng: numF(it.gpslong),
    }))
    .filter((s) => s.nodeId)
    .sort((a, b) => a.order - b.order);
}

const STN_BASE = "http://apis.data.go.kr/1613000/BusSttnInfoInqireService";
const ARV_BASE = "http://apis.data.go.kr/1613000/ArvlInfoInqireService";
const RTE_BASE = "http://apis.data.go.kr/1613000/BusRouteInfoInqireService";

/**
 * envelope의 response.body.totalCount를 정수로 읽는다(없으면 0).
 * A-2 근접정류소 페이징 종료 조건(개정 노트 §3)에 쓰인다 — 받은 후보 수가
 * totalCount에 도달할 때까지 페이지를 더 받아 "진짜 최근접"을 놓치지 않는다.
 */
function readTotalCount(raw: unknown): number {
  const tc = (raw as { response?: { body?: { totalCount?: unknown } } })?.response
    ?.body?.totalCount;
  const n = Number(tc);
  return Number.isFinite(n) ? n : 0;
}

/**
 * TAGO 한 오퍼레이션을 호출하고 표준 envelope JSON을 돌려준다.
 *
 * graceful 원칙: HTTP 실패·JSON 아님·서비스 에러 envelope는 throw(라우트가
 * 502로 변환, "조회 실패"와 "정보 없음"을 구분). 정상 빈결과(resultCode "00"
 * + items:"")는 throw하지 않고 그대로 반환해 파서가 빈 배열을 만든다.
 */
async function fetchTago(
  base: string,
  op: string,
  params: Record<string, string | number>,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(`${base}/${op}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("_type", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, init ?? { cache: "no-store" });
  if (!res.ok) throw new Error(`TAGO ${op} HTTP ${res.status}`);

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // 인증 실패 등은 _type=json이어도 XML 에러로 오기도 한다.
    throw new Error(`TAGO ${op} 비정상 응답: ${text.slice(0, 200)}`);
  }

  const svcErr = (data as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: Record<string, unknown> } })
    .OpenAPI_ServiceResponse;
  if (svcErr) {
    const h = svcErr.cmmMsgHeader ?? {};
    throw new Error(
      `TAGO ${op} 서비스 에러: ${h.returnAuthMsg ?? h.returnReasonCode ?? "unknown"}`,
    );
  }

  const header = (data as { response?: { header?: { resultCode?: unknown; resultMsg?: unknown } } })
    .response?.header;
  const code = header?.resultCode == null ? null : String(header.resultCode);
  // "00"/"0" 정상. NODATA류(03 등)는 정상 빈결과로 통과. 그 외는 장애로 throw.
  if (code != null && code !== "00" && code !== "0") {
    const msg = String(header?.resultMsg ?? code);
    if (code === "03" || /NODATA|NO_?DATA/i.test(msg)) return data;
    throw new Error(`TAGO ${op} resultCode ${code}: ${msg}`);
  }
  return data;
}

/**
 * 좌표 → 근접 정류소 상위 5개 + 각 정류소 도착예정(병렬).
 * 키 없으면 빈 배열(진입점은 키 게이트로 미렌더되므로 방어적).
 */
export async function fetchTagoNearby(
  lat: number,
  lng: number,
): Promise<BusStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  // A-2가 근접순으로 주는 후보를 totalCount에 도달할 때까지(최대 5페이지=500건
  // 안전상한) 모은 뒤 Haversine 정렬→상위 5 cap(개정 노트 §3) — "10건만 받아 슬라이스" 금지.
  // readTotalCount는 envelope의 response.body.totalCount를 숫자로 읽는 헬퍼(없으면 0).
  // 실제 totalCount 호출량은 Task 10에서 실값으로 확정한다.
  const PAGE = 100;
  let candidates: BusStop[] = [];
  let total = Infinity;
  for (let page = 1; candidates.length < total && page <= 5; page++) {
    const raw = await fetchTago(STN_BASE, "getCrdntPrxmtSttnList", {
      gpsLati: lat,
      gpsLong: lng,
      numOfRows: PAGE,
      pageNo: page,
    });
    total = readTotalCount(raw);
    const pageStops = parseBusStops(raw, lat, lng); // arrivalStatus:"ok"·arrivals:[] 기본값으로
    if (pageStops.length === 0) break;
    candidates = candidates.concat(pageStops);
  }
  // 전체 후보를 모은 뒤에야 거리 정렬·상위 5 cap (부분집합 슬라이스 금지)
  const stops = candidates
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);

  const settled = await Promise.allSettled(
    stops.map((s) =>
      fetchTago(ARV_BASE, "getSttnAcctoArvlPrearngeInfoList", {
        cityCode: s.cityCode,
        nodeId: s.nodeId,
        numOfRows: 50,
      }),
    ),
  );
  return stops.map((s, i) => {
    const r = settled[i];
    if (r.status === "rejected") {
      // 도착조회 실패 ≠ 버스 없음(개정 노트 §1) — unavailable로 구분, 빈배열로 뭉개지 않는다.
      console.error(`[tago] 도착조회 실패 ${s.name}:`, r.reason);
      return { ...s, arrivalStatus: "unavailable" as const, arrivals: [] };
    }
    return { ...s, arrivalStatus: "ok" as const, arrivals: parseBusArrivals(r.value) };
  });
}

/** 노선 경유정류소(거의 불변 → 하루 캐시). */
export async function fetchBusRouteStops(
  cityCode: string,
  routeId: string,
): Promise<BusRouteStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchTago(
    RTE_BASE,
    "getRouteAcctoThrghSttnList",
    { cityCode, routeId, numOfRows: 200 },
    { next: { revalidate: 86_400 } },
  );
  return parseBusRouteStops(raw);
}
