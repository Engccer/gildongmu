import type { BusArrival, BusRouteStop, BusStop } from "../types";
import { env } from "../env";
import { haversineMeters } from "../geo";

/**
 * 서울 TOPIS 시내버스 provider(ws.bus.go.kr). TAGO 미수록인 서울 전용.
 * data.go.kr 서울 버스도착정보조회(15000314)·정류소정보조회(15000303)·노선정보조회(15000193)를
 * 기존 DATA_GO_KR_API_KEY로 호출(2026-06-24 키 전파 완료). TAGO와 동일 반환 타입으로 정규화한다.
 *
 * envelope는 서울 TOPIS 형식(msgHeader.headerCd + msgBody.itemList)이라 TAGO와 다른 파서를 쓴다.
 * - headerCd "0"=정상, "4"=결과없음(정상 빈결과), "7"=인증실패, 그 외=장애.
 * - 도착 낭독 정본은 arrmsg1(완성 문장) — traTime1은 운행종료에도 비0이라 슬롯 환산 금지.
 */
type RawItem = Record<string, unknown>;

/** 서울 routeType 숫자코드 → 한글 노선유형(TAGO routetp와 동일 표기). 미매핑은 ""(가짜 분류 금지). */
const SEOUL_ROUTE_TYPE: Record<string, string> = {
  "1": "공항버스",
  "2": "마을버스",
  "3": "간선버스",
  "4": "지선버스",
  "5": "순환버스",
  "6": "광역버스",
};

/** 서울 envelope에서 itemList 배열을 안전 추출. */
export function parseSeoulItems(raw: unknown): RawItem[] {
  const list = (raw as { msgBody?: { itemList?: unknown } })?.msgBody?.itemList;
  if (!list) return [];
  if (Array.isArray(list)) return list as RawItem[];
  if (typeof list === "object") return [list as RawItem];
  return [];
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function numF(v: unknown): number {
  if (v == null || (typeof v === "string" && v.trim() === "")) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function nonNegInt(v: unknown): number {
  const n = numF(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** 근접 정류소 응답 → 거리 오름차순 BusStop[](도착정보는 빈 배열로 시작).
 *  cityCode는 서울 도착/경유 조회에 불필요하지만 타입 호환 위해 "seoul" 센티넬. */
export function parseSeoulStops(
  raw: unknown,
  originLat: number,
  originLng: number,
): BusStop[] {
  return parseSeoulItems(raw)
    .map((it): BusStop => {
      const lat = numF(it.gpsY); // 위도
      const lng = numF(it.gpsX); // 경도
      const arsId = str(it.arsId) || str(it.stationId);
      return {
        nodeId: arsId,
        cityCode: "seoul",
        name: str(it.stationNm),
        stopNo: str(it.arsId) !== "" ? str(it.arsId) : undefined,
        lat,
        lng,
        distanceMeters: Math.round(haversineMeters(originLat, originLng, lat, lng)),
        source: "seoul",
        arrivalStatus: "ok",
        arrivals: [],
      };
    })
    .filter((s) => s.nodeId && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** 도착정보 응답 → BusArrival[]. arrmsg1을 완성 문장 정본으로 담고 API가 준 도착
 *  임박 순서를 그대로 보존한다(traTime1 재정렬은 운행종료·곧도착을 뒤섞으므로 금지).
 *  저상: busType1 "1"=저상. routeType은 숫자코드를 한글로 매핑(미매핑 ""). */
export function parseSeoulArrivals(raw: unknown): BusArrival[] {
  return parseSeoulItems(raw)
    .map((it): BusArrival => ({
      routeId: str(it.busRouteId),
      routeNo: str(it.rtNm),
      routeType: SEOUL_ROUTE_TYPE[str(it.routeType)] ?? "",
      arrivalSeconds: 0, // 서울은 arrivalMessage가 정본 — 슬롯 미사용
      prevStationCount: 0,
      lowFloor: str(it.busType1) === "1",
      arrivalMessage: str(it.arrmsg1),
      source: "seoul",
    }))
    .filter((a) => a.routeNo);
}

/** 노선 경유정류소 응답 → 순번 오름차순 BusRouteStop[]. */
export function parseSeoulRouteStops(raw: unknown): BusRouteStop[] {
  return parseSeoulItems(raw)
    .map((it): BusRouteStop => ({
      nodeId: str(it.station) || str(it.arsId),
      name: str(it.stationNm),
      order: nonNegInt(it.seq),
      lat: numF(it.gpsY),
      lng: numF(it.gpsX),
    }))
    .filter((s) => s.nodeId)
    .sort((a, b) => a.order - b.order);
}

const BASE = "http://ws.bus.go.kr/api/rest";

/** 서울 TOPIS 한 오퍼레이션 호출 + 표준 envelope 반환.
 *  graceful: HTTP 실패·비정상 응답·인증/장애 headerCd는 throw(라우트 502),
 *  정상(headerCd "0")·결과없음(headerCd "4")은 통과. */
async function fetchSeoul(
  path: string,
  params: Record<string, string | number>,
  init?: RequestInit & { next?: { revalidate: number } },
): Promise<unknown> {
  const key = env.DATA_GO_KR_API_KEY!;
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("resultType", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, init ?? { cache: "no-store" });
  if (!res.ok) throw new Error(`Seoul ${path} HTTP ${res.status}`);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Seoul ${path} 비정상 응답: ${text.slice(0, 200)}`);
  }
  const hdr = (data as { msgHeader?: { headerCd?: unknown; headerMsg?: unknown } })?.msgHeader;
  const code = hdr?.headerCd == null ? null : String(hdr.headerCd);
  // "0"=정상, "4"=결과없음(정상 빈결과로 통과). 그 외(7 인증실패 등)는 장애로 throw.
  if (code != null && code !== "0" && code !== "4") {
    const msg = String(hdr?.headerMsg ?? code);
    throw new Error(`Seoul ${path} headerCd ${code}: ${msg}`);
  }
  return data;
}

/** 좌표 → 근접 정류소 상위 5 + 각 정류소 도착(병렬). */
export async function fetchSeoulNearby(lat: number, lng: number): Promise<BusStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchSeoul("stationinfo/getStationByPos", {
    tmX: lng,
    tmY: lat,
    radius: 500,
  });
  const stops = parseSeoulStops(raw, lat, lng).slice(0, 5);
  const settled = await Promise.allSettled(
    stops.map((s) => fetchSeoul("stationinfo/getStationByUid", { arsId: s.nodeId })),
  );
  return stops.map((s, i) => {
    const r = settled[i];
    if (r.status === "rejected") {
      // 도착조회 실패 ≠ 버스 없음 — unavailable로 구분(TAGO 동형).
      console.error(`[seoul] 도착조회 실패 ${s.name}:`, r.reason);
      return { ...s, arrivalStatus: "unavailable" as const, arrivals: [] };
    }
    return { ...s, arrivalStatus: "ok" as const, arrivals: parseSeoulArrivals(r.value) };
  });
}

/** 노선 경유정류소(거의 불변 → 하루 캐시). */
export async function fetchSeoulRouteStops(routeId: string): Promise<BusRouteStop[]> {
  if (!env.DATA_GO_KR_API_KEY) return [];
  const raw = await fetchSeoul(
    "busRouteInfo/getStaionByRoute",
    { busRouteId: routeId },
    { next: { revalidate: 86_400 } },
  );
  return parseSeoulRouteStops(raw);
}
