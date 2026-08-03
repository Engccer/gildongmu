import type { BusArrival, BusRouteStop, BusStop } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";
import {
  fetchDataGoKrJson,
  readItems,
  readResultCode,
  readResultMsg,
  readTotalCount,
} from "./datagokr-envelope";

/**
 * 국토교통부 TAGO(국가대중교통정보센터) 시내버스 provider.
 *
 * 3종 data.go.kr API(인증: DATA_GO_KR_API_KEY 공유):
 * - A-2 BusSttnInfoInqireService/getCrdntPrxmtSttnList — 좌표 근접 정류소
 * - A-1 ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList — 정류소별 도착예정
 * - A-3 BusRouteInfoInqireService/getRouteAcctoThrghSttnList — 노선 경유정류소
 *
 * envelope 모양은 공용 `datagokr-envelope`가 읽는다. 이 파일에 남은 것은 TAGO
 * 고유 정책(허용 resultCode·NODATA 통과)뿐이다. 거리 정렬은 Haversine로 직접
 * 계산한다(A-2가 거리순을 보장하지 않으므로 — 산술은 코드의 책임).
 */

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
  return readItems(raw)
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
  return readItems(raw)
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
  return readItems(raw)
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
 * TAGO 한 오퍼레이션을 호출하고 표준 envelope JSON을 돌려준다.
 *
 * HTTP·XML·게이트웨이 방어는 공용 `fetchDataGoKrJson`이 한다. 여기 남는 것은
 * **TAGO의 resultCode 정책**뿐이다: "00"/"0" 정상, NODATA류(03)는 정상 빈결과로
 * 통과, 그 외는 throw(라우트가 502로 변환 — "조회 실패"와 "정보 없음" 구분).
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

  const data = await fetchDataGoKrJson(url, `TAGO ${op}`, init ?? { cache: "no-store" });

  const code = readResultCode(data);
  if (code != null && code !== "00" && code !== "0") {
    const msg = readResultMsg(data) ?? code;
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
  // 종료 조건에 totalCount를 쓰는 것은 A-2가 전체 건수를 준다는 실호출 확인에
  // 근거한다(공용 readTotalCount는 추출만 하고 신뢰는 보증하지 않는다).
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

/** 단일 정류소 도착예정(B2 추적 폴링) — 도착 임박 순 BusArrival[]. */
export async function fetchTagoArrivals(
  cityCode: string,
  nodeId: string,
): Promise<BusArrival[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchTago(ARV_BASE, "getSttnAcctoArvlPrearngeInfoList", {
    cityCode,
    nodeId,
    numOfRows: 50,
  });
  return parseBusArrivals(raw);
}

/**
 * 좌표 최근접 정류소 후보(B2 §5.2 하차 정류소 해석) — A-2 첫 페이지(고정 ~700m
 * 반경, 조사 §1.2)를 거리순으로. 도착 조회는 하지 않는다(해석 전용 경량 경로).
 */
export async function fetchTagoStopsNear(lat: number, lng: number): Promise<BusStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchTago(STN_BASE, "getCrdntPrxmtSttnList", {
    gpsLati: lat,
    gpsLong: lng,
    numOfRows: 100,
    pageNo: 1,
  });
  return parseBusStops(raw, lat, lng);
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
